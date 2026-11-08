const pad = (n: number) => String(n).padStart(2, "0")

/** yyyy-mm-dd HH:mm:ss in local time */
export function formatDateTime(date: Date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
