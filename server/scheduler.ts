export function nextScheduled(time: string, zone: string, after = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = (timestamp: number) => {
    const values = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]));
    return { day: values.year + values.month + values.day, at: values.hour + ':' + values.minute };
  };
  const now = parts(after.getTime());
  const start = Math.floor(after.getTime() / 60000) * 60000;
  for (let offset = 1; offset <= 60 * 30; offset++) {
    const target = start + offset * 60000;
    const local = parts(target);
    if ((local.day !== now.day || now.at < time) && local.at >= time) return new Date(target);
  }
  throw new Error('Nie można wyznaczyć kolejnego terminu.');
}
