// Device-local defaults for each connection and model.
const DEFAULT_REPLY_TOKENS = 4096;
function validateResponseSettings(row) {
  if (!row || typeof row.model !== 'string' || !row.model.trim() || row.model.length > 200)
    throw new Error('Choose a model for response settings.');
  if (!Number.isInteger(row.maxReplyTokens) || row.maxReplyTokens < 1 || row.maxReplyTokens > 131072)
    throw new Error('Enter a whole reply limit from 1 to 131,072 tokens.');
  if (row.temperature !== null && (typeof row.temperature !== 'number' || !Number.isFinite(row.temperature) || row.temperature < 0 || row.temperature > 2))
    throw new Error('Enter a temperature from 0 to 2, or leave it blank for the provider default.');
  return { model: row.model.trim(), maxReplyTokens: row.maxReplyTokens, temperature: row.temperature };
}
function responseSettings(profile, model) {
  const row = profile?.responseSettings?.find(row => row.model === model);
  return row ? validateResponseSettings(row) : { model, maxReplyTokens: DEFAULT_REPLY_TOKENS, temperature: null };
}
module.exports = { DEFAULT_REPLY_TOKENS, validateResponseSettings, responseSettings };
