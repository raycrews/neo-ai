function composeUrl(method, { to, subject, body }) {
  if (typeof to !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('Enter a valid email address.');
  if (typeof subject !== 'string' || typeof body !== 'string') throw new Error('Invalid email draft.');
  const encode = encodeURIComponent;
  if (method === 'gmail') return `https://mail.google.com/mail/?view=cm&fs=1&to=${encode(to)}&su=${encode(subject)}&body=${encode(body)}`;
  if (method === 'outlook') return `https://outlook.live.com/mail/0/deeplink/compose?to=${encode(to)}&subject=${encode(subject)}&body=${encode(body)}`;
  if (method === 'default') return `mailto:${encode(to)}?subject=${encode(subject)}&body=${encode(body)}`;
  throw new Error('Choose an email method in File → Email Settings.');
}
async function openCompose(shell, method, message, file) {
  const url = composeUrl(method, message);
  let opened = true;
  try { await shell.openExternal(url); } catch { opened = false; }
  shell.showItemInFolder(file);
  return { ok: opened, method, file, manualAttachment: true };
}
module.exports = { composeUrl, openCompose };
