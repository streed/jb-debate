import { search } from 'duck-duck-scrape';

/**
 * Search the web for information on a topic
 * @param {string} query - The search query
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Promise<string>} - Formatted search results
 */
export async function searchWeb(query, maxResults = 5) {
  try {
    const results = await search(query, {
      safeSearch: 0,
    });

    if (!results.results || results.results.length === 0) {
      return null;
    }

    const formattedResults = results.results
      .slice(0, maxResults)
      .map((result, index) => {
        return `[${index + 1}] ${result.title}\n${result.description}\nSource: ${result.url}`;
      })
      .join('\n\n');

    return formattedResults;
  } catch (error) {
    console.error('Web search error:', error);
    return null;
  }
}

/**
 * Search for facts and evidence on a debate topic
 * @param {string} subject - The debate subject
 * @returns {Promise<string>} - Compiled research
 */
export async function researchDebateTopic(subject) {
  const queries = [
    subject,
    `${subject} facts statistics`,
    `${subject} arguments for against`,
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const results = await searchWeb(query, 3);
      if (results) {
        allResults.push(results);
      }
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Search failed for query "${query}":`, error);
    }
  }

  if (allResults.length === 0) {
    return null;
  }

  return allResults.join('\n\n---\n\n');
}

/**
 * Search for counter-arguments to a specific claim
 * @param {string} claim - The claim to find counter-arguments for
 * @returns {Promise<string>} - Counter-argument research
 */
export async function findCounterArguments(claim) {
  const queries = [
    `arguments against ${claim}`,
    `why ${claim} is wrong`,
    `${claim} criticism`,
  ];

  const results = [];

  for (const query of queries) {
    try {
      const searchResults = await searchWeb(query, 2);
      if (searchResults) {
        results.push(searchResults);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`Counter-argument search failed:`, error);
    }
  }

  return results.length > 0 ? results.join('\n\n') : null;
}
