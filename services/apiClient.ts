import { addLogEntry } from './aiLogService';
import { getVeoAuthTokens } from './userService';

export const getVeoProxyUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://veo.monoklix.com';
  }
  // In development, vite.config.js proxies requests starting with /api.
  // Using a relative path (by returning an empty string) ensures these requests
  // go to the Vite dev server and are proxied correctly.
  return '';
};

export const getImagenProxyUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://gem.monoklix.com';
  }
  // In development, vite.config.js proxies requests starting with /api.
  // Using a relative path (by returning an empty string) ensures these requests
  // go to the Vite dev server and are proxied correctly.
  return '';
};


const getTokens = (): { token: string; createdAt: string }[] => {
    const tokensJSON = sessionStorage.getItem('veoAuthTokens');
    if (tokensJSON) {
        try {
            const parsed = JSON.parse(tokensJSON);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        } catch (e) {
            console.error("Could not parse VEO/Imagen tokens from session storage", e);
        }
    }
    return [];
};

/**
 * A robust fetch wrapper that handles Veo/Imagen token rotation and retries.
 * @param endpoint - The API endpoint to call (e.g., '/api/veo/generate-t2v').
 * @param requestBody - The JSON body for the POST request.
 * @param logContext - A string describing the operation for logging purposes (e.g., 'VEO T2V').
 * @param specificToken - If provided, bypasses rotation and uses only this token.
 * @returns An object containing the JSON response `data` and the `successfulToken` used.
 */
export const fetchWithTokenRotation = async (
  endpoint: string,
  requestBody: any,
  logContext: string,
  specificToken?: string
): Promise<{ data: any; successfulToken: string }> => {
  console.log(`[API Client] Starting process for: ${logContext}`);

  let tokens = specificToken ? [{ token: specificToken, createdAt: 'N/A' }] : getTokens();

  // If tokens are missing from session (and not using a specific one), try to re-fetch them automatically.
  if (tokens.length === 0 && !specificToken) {
      console.log(`[API Client] No tokens in session for ${logContext}. Attempting re-fetch.`);
      addLogEntry({
          model: logContext,
          prompt: 'Auth Token Refresh',
          output: 'No tokens found in session. Attempting to re-fetch from database.',
          tokenCount: 0,
          status: 'Success'
      });
      try {
          const newTokens = await getVeoAuthTokens();
          if (newTokens && newTokens.length > 0) {
              sessionStorage.setItem('veoAuthTokens', JSON.stringify(newTokens));
              tokens = newTokens;
              console.log(`[API Client] Successfully re-fetched ${newTokens.length} tokens.`);
              addLogEntry({
                  model: logContext,
                  prompt: 'Auth Token Refresh',
                  output: `Successfully re-fetched ${newTokens.length} tokens.`,
                  tokenCount: 0,
                  status: 'Success'
              });
          }
      } catch (e) {
          console.error('[API Client] Failed to re-fetch auth tokens:', e);
          addLogEntry({
              model: logContext,
              prompt: 'Auth Token Refresh',
              output: `Failed to re-fetch tokens: ${e instanceof Error ? e.message : 'Unknown error'}`,
              tokenCount: 0,
              status: 'Error',
              error: e instanceof Error ? e.message : 'Unknown error'
          });
      }
  }

  if (tokens.length === 0) {
    console.error(`[API Client] Aborting ${logContext}: No auth tokens available after check.`);
    throw new Error(`Auth Token is required for ${logContext}. Please set it via the Key icon in the header.`);
  }

  let lastError: any = null;

  for (let i = 0; i < tokens.length; i++) {
    const currentAuthToken = tokens[i].token;
    
    console.log(`[API Client] Attempting ${logContext} with token #${i + 1} (...${currentAuthToken.slice(-6)})`);
    addLogEntry({
        model: logContext,
        prompt: `Attempting ${logContext} with token #${i + 1}`,
        output: `Using token ending in ...${currentAuthToken.slice(-6)}`,
        tokenCount: 0,
        status: "Success"
    });

    try {
      console.log(`[API Client] Sending POST to ${endpoint}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentAuthToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[API Client] Received response for ${logContext}. Status: ${response.status}`);
      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error?.message || data.message || `API call failed (${response.status})`;
        throw new Error(errorMessage);
      }
      
      console.log(`✅ [API Client] Success for ${logContext} with token #${i + 1}`);
      return { data, successfulToken: currentAuthToken };

    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ [API Client] Token #${i + 1} failed for ${logContext}:`, errorMessage);
      addLogEntry({
        model: logContext,
        prompt: `Token #${i + 1} failed`,
        output: errorMessage,
        tokenCount: 0,
        status: 'Error',
        error: errorMessage
      });

      if (i < tokens.length - 1) {
        console.log(`[API Client] Retrying with next token...`);
        addLogEntry({
          model: logContext,
          prompt: 'Retrying with next token...',
          output: 'Fallback mechanism initiated.',
          tokenCount: 0,
          status: "Success"
        });
      }
    }
  }

  console.error(`[API Client] All ${tokens.length} tokens failed for ${logContext}. Final error:`, lastError);
  addLogEntry({
    model: logContext,
    prompt: 'All available auth tokens failed.',
    output: `Final error: ${lastError.message}`,
    tokenCount: 0,
    status: 'Error',
    error: lastError.message
  });
  throw lastError;
};