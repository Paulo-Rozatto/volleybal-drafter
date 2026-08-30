export const GIST_ID = '58f047706f0f4c48bc83b18aab5e5949';
export const DEFAULT_FILENAME = 'players.json';
export const ENCRYPTED_GITHUB_TOKEN = 'Dh4mcqVeMAbw4SEOao+YGy+FZy6eEzQDxZ3fu30e3XuRWA7d/GATh9n0dQASmvfH5DLwOCJT+uak41sEDSPlolIN1NyCsqBc0olt7GkR7mIUStS1dFTA+cjZmaBlAtmPDOqFrxsA4LsnrxES85OWKKxxjUdoWWFDuQ==';

/**
 * Loads the player array from the Gist.
 */
export async function loadPlayersFromGist() {
  const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Gist: ${response.statusText}`);
  }

  const data = await response.json();
  // Get the first available file or players.json
  const file = data.files[DEFAULT_FILENAME] || Object.values(data.files)[0];

  if (!file || !file.content) {
    return [];
  }

  return JSON.parse(file.content);
}

/**
 * Saves the player array back to the Gist.
 */
export async function savePlayersToGist(players, token) {
  if (!token) {
    throw new Error('GitHub Personal Access Token is required to save.');
  }

  const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        [DEFAULT_FILENAME]: {
          content: JSON.stringify(players, null, 2),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update Gist: ${response.statusText}`);
  }

  return await response.json();
}