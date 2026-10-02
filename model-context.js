// Only reported capacities are used. A model's name is not a token limit.
const validLimit = n => Number.isSafeInteger(n) && n >= 512 && n <= 10000000;
function reportedModels(data) {
  return (data.data || []).flatMap(m => {
    if (typeof m?.id !== 'string' || m.id.length > 200) return [];
    const limits = [m.context_length, m.top_provider?.context_length].filter(validLimit);
    return limits.length ? [{ model: m.id, limit: Math.min(...limits), source: 'server' }] : [];
  });
}
function loadedModels(data) {
  return (Array.isArray(data.models) ? data.models : []).flatMap(m => {
    if (m.type !== 'llm' || !Array.isArray(m.loaded_instances)) return [];
    return m.loaded_instances.flatMap(instance => typeof instance.id === 'string' && instance.id.length <= 200 && validLimit(instance.config?.context_length)
      ? [{ model: instance.id, limit: instance.config.context_length, source: 'loaded' }] : []);
  });
}
module.exports = { validLimit, reportedModels, loadedModels };
