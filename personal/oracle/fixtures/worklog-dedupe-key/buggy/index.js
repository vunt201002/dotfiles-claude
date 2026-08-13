export function countTasks(saves) {
  const seen = new Set();
  const tasks = [];
  for (const save of saves) {
    const key = save.branch;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ branch: save.branch, nextAction: save.nextAction });
  }
  return tasks;
}
