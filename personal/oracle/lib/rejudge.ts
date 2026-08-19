export function rejudgeRepeat(argv: string[]): number {
  const index = argv.indexOf('--repeat');
  if (index === -1) return 1;
  if (!argv.includes('--rejudge')) throw new Error('--repeat is only valid with --rejudge');
  const value = argv[index + 1];
  const repeat = Number(value);
  if (!value || !Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat requires a positive integer');
  return repeat;
}
