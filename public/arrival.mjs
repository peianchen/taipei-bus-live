export function describeArrival(seconds) {
  if (seconds === 0) return '即將進站';
  if (Number.isInteger(seconds) && seconds > 0) return `約 ${Math.max(1, Math.ceil(seconds / 60))} 分鐘`;
  return {
    '-1': '尚未發車',
    '-2': '交管不停靠',
    '-3': '末班車已過',
    '-4': '今日未營運',
  }[seconds] || '目前無預估';
}
