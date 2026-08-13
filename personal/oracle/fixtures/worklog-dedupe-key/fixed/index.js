function normalizeBranchKey(branch) {
  const stripped = String(branch).replace(/[^a-zA-Z0-9._-]/g, '');
  return stripped || 'unknown';
}

export function countTasks(saves) {
  const seen = new Set();
  const tasks = [];
  for (const save of saves) {
    const key = normalizeBranchKey(save.branch);
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ branch: save.branch, nextAction: save.nextAction });
  }
  return tasks;
}
