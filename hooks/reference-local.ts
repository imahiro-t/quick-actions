// The standalone local reference tables: ascii-table, http-status, mime-types
// and port-numbers. Their data lives here, in the source; nothing is fetched.
//
// Synchronous and pure, as LocalAction asks: ECMAScript's built-ins alone, no
// Intl, localeCompare or toLocale*String (case is folded with toLowerCase).
// A text argument that names nothing in the table is answered with
// `{ error }`; no argument lists the table.

import type { LocalInput, LocalOutput } from './actions'
import type { Lang } from './i18n'
import { invalid, textOf } from './local-args'
import type { Texts } from './local-args'

const pick = (lang: Lang, t: Texts) => t[lang]

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')

// ---------------------------------------------------------------------------
// ASCII.

/** The printable ASCII characters, 0x20 to 0x7E. */
export const ASCII_FIRST = 0x20
export const ASCII_LAST = 0x7e

type Control = { name: string; code: number; escape: string; meaning: Texts }

export const CONTROLS: readonly Control[] = [
  { name: 'NUL', code: 0x00, escape: '\\0', meaning: { ja: 'ヌル文字（C の文字列の終端）', en: 'null (ends a C string)' } },
  { name: 'BEL', code: 0x07, escape: '\\a', meaning: { ja: 'ベル（警告音）', en: 'bell' } },
  { name: 'BS', code: 0x08, escape: '\\b', meaning: { ja: 'バックスペース', en: 'backspace' } },
  { name: 'TAB', code: 0x09, escape: '\\t', meaning: { ja: '水平タブ', en: 'horizontal tab' } },
  { name: 'LF', code: 0x0a, escape: '\\n', meaning: { ja: '改行（Unix の行末）', en: 'line feed (the Unix line end)' } },
  { name: 'VT', code: 0x0b, escape: '\\v', meaning: { ja: '垂直タブ', en: 'vertical tab' } },
  { name: 'FF', code: 0x0c, escape: '\\f', meaning: { ja: '改ページ', en: 'form feed' } },
  { name: 'CR', code: 0x0d, escape: '\\r', meaning: { ja: '復帰（Windows の行末は CR LF）', en: 'carriage return (the Windows line end is CR LF)' } },
  { name: 'ESC', code: 0x1b, escape: '\\e', meaning: { ja: 'エスケープ（端末の制御シーケンスの開始）', en: 'escape (starts a terminal control sequence)' } },
  { name: 'DEL', code: 0x7f, escape: '-', meaning: { ja: '削除', en: 'delete' } },
]

const ASCII_ROWS = 19

/** The printable ASCII characters (space as SP) in five columns of decimal, hexadecimal and character, then the main control characters. */
export const asciiTable = ({ lang }: LocalInput): LocalOutput => {
  const count = ASCII_LAST - ASCII_FIRST + 1
  const columns = Math.ceil(count / ASCII_ROWS)
  const entry = (code: number) => `${String(code).padStart(3, ' ')} ${hex2(code)} ${code === 0x20 ? 'SP' : String.fromCharCode(code).padEnd(2, ' ')}`
  const lines: string[] = [Array.from({ length: columns }, () => 'Dec Hx Ch').join('   ')]
  for (let r = 0; r < ASCII_ROWS; r++) {
    const cells: string[] = []
    for (let c = 0; c < columns; c++) {
      const code = ASCII_FIRST + c * ASCII_ROWS + r
      if (code <= ASCII_LAST) cells.push(entry(code))
    }
    lines.push(cells.join('   ').trimEnd())
  }
  const controls = CONTROLS.map(
    k => `${k.name.padEnd(4, ' ')} ${String(k.code).padStart(3, ' ')}  0x${hex2(k.code)}  ${k.escape.padEnd(3, ' ')}  ${pick(lang, k.meaning)}`,
  )
  return {
    text: [
      lang === 'ja' ? '表示可能な ASCII 文字（0x20〜0x7E。SP は空白）:' : 'Printable ASCII (0x20 to 0x7E; SP is the space):',
      ...lines,
      '',
      lang === 'ja' ? '主な制御文字（名前・10 進・16 進・エスケープ・説明）:' : 'Main control characters (name, decimal, hexadecimal, escape, meaning):',
      ...controls,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// HTTP status codes.

type Status = { code: number; name: string; meaning: Texts; common?: true }

export const HTTP_STATUSES: readonly Status[] = [
  { code: 100, name: 'Continue', meaning: { ja: 'リクエストの続きを送ってよい', en: 'go on sending the request' } },
  { code: 101, name: 'Switching Protocols', meaning: { ja: 'プロトコルを切り替える（WebSocket など）', en: 'switching protocols (WebSocket and the like)' } },
  { code: 103, name: 'Early Hints', meaning: { ja: '本応答の前に先読みのヒントを送る', en: 'hints to preload before the final response' } },
  { code: 200, name: 'OK', meaning: { ja: '成功', en: 'success' }, common: true },
  { code: 201, name: 'Created', meaning: { ja: '作成した（Location に新しいリソース）', en: 'created (the new resource in Location)' }, common: true },
  { code: 202, name: 'Accepted', meaning: { ja: '受け付けたが処理はまだ', en: 'accepted, not yet processed' }, common: true },
  { code: 204, name: 'No Content', meaning: { ja: '成功、本文なし', en: 'success, no body' }, common: true },
  { code: 206, name: 'Partial Content', meaning: { ja: '範囲リクエストの一部を返す', en: 'part of a range request' } },
  { code: 301, name: 'Moved Permanently', meaning: { ja: '恒久的に移動した', en: 'moved for good' }, common: true },
  { code: 302, name: 'Found', meaning: { ja: '一時的に別の URL にある', en: 'temporarily at another URL' }, common: true },
  { code: 303, name: 'See Other', meaning: { ja: '別の URL を GET で見る', en: 'GET another URL' } },
  { code: 304, name: 'Not Modified', meaning: { ja: '変更なし（キャッシュを使う）', en: 'not modified (use the cache)' }, common: true },
  { code: 307, name: 'Temporary Redirect', meaning: { ja: '一時的なリダイレクト（メソッドを変えない）', en: 'temporary redirect (same method)' }, common: true },
  { code: 308, name: 'Permanent Redirect', meaning: { ja: '恒久的なリダイレクト（メソッドを変えない）', en: 'permanent redirect (same method)' }, common: true },
  { code: 400, name: 'Bad Request', meaning: { ja: 'リクエストが不正', en: 'the request is malformed' }, common: true },
  { code: 401, name: 'Unauthorized', meaning: { ja: '認証が必要・認証に失敗した', en: 'authentication needed or failed' }, common: true },
  { code: 403, name: 'Forbidden', meaning: { ja: '権限がない', en: 'not allowed' }, common: true },
  { code: 404, name: 'Not Found', meaning: { ja: '見つからない', en: 'not found' }, common: true },
  { code: 405, name: 'Method Not Allowed', meaning: { ja: 'そのメソッドは使えない', en: 'that method is not allowed' }, common: true },
  { code: 406, name: 'Not Acceptable', meaning: { ja: 'Accept に合う形式で返せない', en: 'no form matching Accept' } },
  { code: 408, name: 'Request Timeout', meaning: { ja: 'リクエストが時間切れ', en: 'the request timed out' }, common: true },
  { code: 409, name: 'Conflict', meaning: { ja: '現在の状態と衝突する', en: 'conflicts with the current state' }, common: true },
  { code: 410, name: 'Gone', meaning: { ja: '恒久的に削除された', en: 'gone for good' }, common: true },
  { code: 411, name: 'Length Required', meaning: { ja: 'Content-Length が必要', en: 'Content-Length is required' } },
  { code: 412, name: 'Precondition Failed', meaning: { ja: '条件付きリクエストの前提が成り立たない', en: 'a precondition does not hold' } },
  { code: 413, name: 'Content Too Large', meaning: { ja: '本文が大きすぎる', en: 'the body is too large' }, common: true },
  { code: 414, name: 'URI Too Long', meaning: { ja: 'URI が長すぎる', en: 'the URI is too long' } },
  { code: 415, name: 'Unsupported Media Type', meaning: { ja: '本文の形式に対応していない', en: 'the body type is not supported' }, common: true },
  { code: 416, name: 'Range Not Satisfiable', meaning: { ja: '範囲指定に応えられない', en: 'the range cannot be served' } },
  { code: 418, name: "I'm a teapot", meaning: { ja: 'ティーポットなのでコーヒーは淹れられない（冗談のコード）', en: 'a teapot cannot brew coffee (a joke code)' } },
  { code: 422, name: 'Unprocessable Content', meaning: { ja: '形式は正しいが内容を処理できない（検証エラーなど）', en: 'well-formed but cannot be processed (a validation error and the like)' }, common: true },
  { code: 425, name: 'Too Early', meaning: { ja: '早すぎて処理できない（リプレイの恐れ）', en: 'too early to process (risk of replay)' } },
  { code: 428, name: 'Precondition Required', meaning: { ja: '条件付きリクエストにする必要がある', en: 'the request must be conditional' } },
  { code: 429, name: 'Too Many Requests', meaning: { ja: 'リクエストが多すぎる（レート制限）', en: 'too many requests (rate limited)' }, common: true },
  { code: 431, name: 'Request Header Fields Too Large', meaning: { ja: 'ヘッダーが大きすぎる', en: 'the headers are too large' } },
  { code: 451, name: 'Unavailable For Legal Reasons', meaning: { ja: '法的な理由で提供できない', en: 'unavailable for legal reasons' } },
  { code: 500, name: 'Internal Server Error', meaning: { ja: 'サーバー内部のエラー', en: 'an error inside the server' }, common: true },
  { code: 501, name: 'Not Implemented', meaning: { ja: 'サーバーが機能を実装していない', en: 'the server does not implement it' }, common: true },
  { code: 502, name: 'Bad Gateway', meaning: { ja: '上流のサーバーから不正な応答', en: 'a bad response from the upstream server' }, common: true },
  { code: 503, name: 'Service Unavailable', meaning: { ja: '一時的に利用できない（過負荷・メンテナンス）', en: 'temporarily unavailable (overload, maintenance)' }, common: true },
  { code: 504, name: 'Gateway Timeout', meaning: { ja: '上流のサーバーが時間切れ', en: 'the upstream server timed out' }, common: true },
  { code: 505, name: 'HTTP Version Not Supported', meaning: { ja: 'その HTTP バージョンに対応していない', en: 'that HTTP version is not supported' } },
]

const STATUS_CLASSES: readonly Texts[] = [
  { ja: '1xx 情報（処理を続けている）', en: '1xx informational (still in progress)' },
  { ja: '2xx 成功', en: '2xx success' },
  { ja: '3xx リダイレクト', en: '3xx redirection' },
  { ja: '4xx クライアントエラー', en: '4xx client error' },
  { ja: '5xx サーバーエラー', en: '5xx server error' },
]

const statusLine = (s: Status, lang: Lang) => `${s.code} ${s.name}: ${pick(lang, s.meaning)}`

const HTTP_TEXT: Texts = {
  ja: '100〜599 のステータスコード（例: 404）か名前の一部（例: not found）',
  en: 'a status code from 100 to 599 (e.g. 404) or part of its name (e.g. not found)',
}

/** A status code's name and meaning, the codes whose name holds the text, or (with no argument) the common ones. */
export const httpStatus = (input: LocalInput): LocalOutput => {
  const { lang } = input
  const text = textOf(input.arg)
  if (text === undefined) return invalid(lang, HTTP_TEXT)
  const q = text
  if (q === '') {
    return {
      text: [lang === 'ja' ? 'よく使う HTTP ステータスコード:' : 'Common HTTP status codes:', ...HTTP_STATUSES.filter(s => s.common).map(s => statusLine(s, lang))].join('\n'),
    }
  }
  if (/^\d+$/.test(q)) {
    const code = Number(q)
    if (code < 100 || code > 599) {
      return { error: lang === 'ja' ? `HTTP ステータスコードは 100〜599 です: ${q}` : `HTTP status codes run from 100 to 599: ${q}` }
    }
    const found = HTTP_STATUSES.find(s => s.code === code)
    const kind = pick(lang, STATUS_CLASSES[Math.floor(code / 100) - 1]!)
    if (found !== undefined) return { text: [statusLine(found, lang), lang === 'ja' ? `分類: ${kind}` : `Class: ${kind}`].join('\n') }
    return {
      text: lang === 'ja' ? `${code}: この表にはありません。分類: ${kind}` : `${code}: not in this table. Class: ${kind}`,
    }
  }
  const needle = q.toLowerCase()
  const matches = HTTP_STATUSES.filter(s => s.name.toLowerCase().includes(needle))
  if (matches.length === 0) {
    return { error: lang === 'ja' ? `該当するステータスがありません: ${q}（${HTTP_TEXT.ja}）` : `No status matches ${q} (give ${HTTP_TEXT.en}).` }
  }
  return { text: matches.map(s => statusLine(s, lang)).join('\n') }
}

// ---------------------------------------------------------------------------
// MIME types.

/** Extension to MIME type: the common ones. An extension appears once; a type may have several. */
export const MIME_TYPES: readonly (readonly [string, string])[] = [
  ['html', 'text/html'], ['htm', 'text/html'], ['css', 'text/css'], ['js', 'text/javascript'], ['mjs', 'text/javascript'],
  ['cjs', 'text/javascript'], ['json', 'application/json'], ['jsonld', 'application/ld+json'], ['map', 'application/json'],
  ['xml', 'application/xml'], ['txt', 'text/plain'], ['md', 'text/markdown'], ['csv', 'text/csv'], ['tsv', 'text/tab-separated-values'],
  ['yaml', 'application/yaml'], ['yml', 'application/yaml'], ['toml', 'application/toml'], ['ics', 'text/calendar'],
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'],
  ['avif', 'image/avif'], ['svg', 'image/svg+xml'], ['ico', 'image/vnd.microsoft.icon'], ['bmp', 'image/bmp'], ['tif', 'image/tiff'],
  ['tiff', 'image/tiff'], ['heic', 'image/heic'],
  ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['ogg', 'audio/ogg'], ['oga', 'audio/ogg'], ['m4a', 'audio/mp4'], ['flac', 'audio/flac'],
  ['aac', 'audio/aac'], ['weba', 'audio/webm'],
  ['mp4', 'video/mp4'], ['webm', 'video/webm'], ['ogv', 'video/ogg'], ['mov', 'video/quicktime'], ['avi', 'video/x-msvideo'], ['mpeg', 'video/mpeg'],
  ['woff', 'font/woff'], ['woff2', 'font/woff2'], ['ttf', 'font/ttf'], ['otf', 'font/otf'],
  ['pdf', 'application/pdf'], ['zip', 'application/zip'], ['gz', 'application/gzip'], ['tar', 'application/x-tar'], ['7z', 'application/x-7z-compressed'],
  ['bz2', 'application/x-bzip2'], ['rar', 'application/vnd.rar'], ['wasm', 'application/wasm'], ['bin', 'application/octet-stream'],
  ['doc', 'application/msword'], ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ppt', 'application/vnd.ms-powerpoint'], ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['rtf', 'application/rtf'], ['epub', 'application/epub+zip'], ['sh', 'application/x-sh'], ['jar', 'application/java-archive'],
]

const MIME_TEXT: Texts = {
  ja: '拡張子（例: json, .png, file.tar.gz）か MIME タイプ（例: image/png）',
  en: 'an extension (e.g. json, .png, file.tar.gz) or a MIME type (e.g. image/png)',
}

const mimeLine = ([ext, type]: readonly [string, string]) => `.${ext}  ${type}`

/** The MIME type of an extension (or a file name's last one), the extensions of a MIME type, or (with no argument) the table. */
export const mimeTypes = (input: LocalInput): LocalOutput => {
  const { lang } = input
  const text = textOf(input.arg)
  if (text === undefined) return invalid(lang, MIME_TEXT)
  const q = text.toLowerCase()
  if (q === '') {
    return { text: [lang === 'ja' ? 'よく使う拡張子と MIME タイプ:' : 'Common extensions and MIME types:', ...MIME_TYPES.map(mimeLine)].join('\n') }
  }
  if (q.includes('/')) {
    // A parameter (`; charset=utf-8`) is left out.
    const type = q.split(';')[0]!.trim()
    const exts = MIME_TYPES.filter(([, t]) => t === type).map(([e]) => `.${e}`)
    if (exts.length === 0) {
      return { error: lang === 'ja' ? `この表にない MIME タイプです: ${text}` : `Not a MIME type in this table: ${text}` }
    }
    return { text: lang === 'ja' ? `${type} の拡張子: ${exts.join(', ')}` : `Extensions of ${type}: ${exts.join(', ')}` }
  }
  const dot = q.lastIndexOf('.')
  const ext = dot >= 0 ? q.slice(dot + 1) : q
  if (!/^[a-z0-9]+$/.test(ext)) return invalid(lang, MIME_TEXT)
  const found = MIME_TYPES.find(([e]) => e === ext)
  if (found === undefined) {
    return { error: lang === 'ja' ? `この表にない拡張子です: .${ext}` : `Not an extension in this table: .${ext}` }
  }
  return { text: mimeLine(found) }
}

// ---------------------------------------------------------------------------
// Port numbers.

type Port = { port: number; proto: 'TCP' | 'UDP' | 'TCP/UDP'; name: string; aliases: readonly string[]; meaning: Texts }

export const PORTS: readonly Port[] = [
  { port: 20, proto: 'TCP', name: 'ftp-data', aliases: [], meaning: { ja: 'FTP のデータ転送', en: 'FTP data transfer' } },
  { port: 21, proto: 'TCP', name: 'ftp', aliases: [], meaning: { ja: 'FTP の制御', en: 'FTP control' } },
  { port: 22, proto: 'TCP', name: 'ssh', aliases: ['sftp', 'scp'], meaning: { ja: 'SSH（SFTP・SCP も）', en: 'SSH (SFTP and SCP too)' } },
  { port: 23, proto: 'TCP', name: 'telnet', aliases: [], meaning: { ja: 'Telnet（暗号化なし）', en: 'Telnet (unencrypted)' } },
  { port: 25, proto: 'TCP', name: 'smtp', aliases: [], meaning: { ja: 'メール転送（SMTP）', en: 'mail relay (SMTP)' } },
  { port: 53, proto: 'TCP/UDP', name: 'dns', aliases: ['domain'], meaning: { ja: 'DNS', en: 'DNS' } },
  { port: 67, proto: 'UDP', name: 'dhcp', aliases: ['bootps'], meaning: { ja: 'DHCP サーバー', en: 'DHCP server' } },
  { port: 68, proto: 'UDP', name: 'dhcp-client', aliases: ['bootpc'], meaning: { ja: 'DHCP クライアント', en: 'DHCP client' } },
  { port: 69, proto: 'UDP', name: 'tftp', aliases: [], meaning: { ja: 'TFTP', en: 'TFTP' } },
  { port: 80, proto: 'TCP', name: 'http', aliases: ['www'], meaning: { ja: 'HTTP', en: 'HTTP' } },
  { port: 110, proto: 'TCP', name: 'pop3', aliases: [], meaning: { ja: 'メール受信（POP3）', en: 'mail retrieval (POP3)' } },
  { port: 123, proto: 'UDP', name: 'ntp', aliases: [], meaning: { ja: '時刻同期（NTP）', en: 'time sync (NTP)' } },
  { port: 143, proto: 'TCP', name: 'imap', aliases: [], meaning: { ja: 'メール受信（IMAP）', en: 'mail access (IMAP)' } },
  { port: 161, proto: 'UDP', name: 'snmp', aliases: [], meaning: { ja: 'SNMP', en: 'SNMP' } },
  { port: 389, proto: 'TCP', name: 'ldap', aliases: [], meaning: { ja: 'LDAP', en: 'LDAP' } },
  { port: 443, proto: 'TCP/UDP', name: 'https', aliases: [], meaning: { ja: 'HTTPS（UDP は HTTP/3）', en: 'HTTPS (UDP for HTTP/3)' } },
  { port: 445, proto: 'TCP', name: 'smb', aliases: ['cifs'], meaning: { ja: 'Windows のファイル共有（SMB）', en: 'Windows file sharing (SMB)' } },
  { port: 465, proto: 'TCP', name: 'smtps', aliases: [], meaning: { ja: 'SMTP over TLS', en: 'SMTP over TLS' } },
  { port: 514, proto: 'UDP', name: 'syslog', aliases: [], meaning: { ja: 'syslog', en: 'syslog' } },
  { port: 587, proto: 'TCP', name: 'submission', aliases: [], meaning: { ja: 'メール送信（サブミッション）', en: 'mail submission' } },
  { port: 636, proto: 'TCP', name: 'ldaps', aliases: [], meaning: { ja: 'LDAP over TLS', en: 'LDAP over TLS' } },
  { port: 993, proto: 'TCP', name: 'imaps', aliases: [], meaning: { ja: 'IMAP over TLS', en: 'IMAP over TLS' } },
  { port: 995, proto: 'TCP', name: 'pop3s', aliases: [], meaning: { ja: 'POP3 over TLS', en: 'POP3 over TLS' } },
  { port: 1194, proto: 'UDP', name: 'openvpn', aliases: [], meaning: { ja: 'OpenVPN', en: 'OpenVPN' } },
  { port: 1433, proto: 'TCP', name: 'mssql', aliases: ['sqlserver'], meaning: { ja: 'Microsoft SQL Server', en: 'Microsoft SQL Server' } },
  { port: 1521, proto: 'TCP', name: 'oracle', aliases: [], meaning: { ja: 'Oracle Database', en: 'Oracle Database' } },
  { port: 2049, proto: 'TCP/UDP', name: 'nfs', aliases: [], meaning: { ja: 'NFS', en: 'NFS' } },
  { port: 2181, proto: 'TCP', name: 'zookeeper', aliases: [], meaning: { ja: 'Apache ZooKeeper', en: 'Apache ZooKeeper' } },
  { port: 2375, proto: 'TCP', name: 'docker', aliases: [], meaning: { ja: 'Docker API（暗号化なし）', en: 'Docker API (unencrypted)' } },
  { port: 2376, proto: 'TCP', name: 'docker-tls', aliases: [], meaning: { ja: 'Docker API（TLS）', en: 'Docker API (TLS)' } },
  { port: 3306, proto: 'TCP', name: 'mysql', aliases: ['mariadb'], meaning: { ja: 'MySQL・MariaDB', en: 'MySQL, MariaDB' } },
  { port: 3389, proto: 'TCP', name: 'rdp', aliases: [], meaning: { ja: 'リモートデスクトップ（RDP）', en: 'Remote Desktop (RDP)' } },
  { port: 5353, proto: 'UDP', name: 'mdns', aliases: ['bonjour'], meaning: { ja: 'マルチキャスト DNS', en: 'multicast DNS' } },
  { port: 5432, proto: 'TCP', name: 'postgresql', aliases: ['postgres'], meaning: { ja: 'PostgreSQL', en: 'PostgreSQL' } },
  { port: 5672, proto: 'TCP', name: 'amqp', aliases: ['rabbitmq'], meaning: { ja: 'AMQP（RabbitMQ）', en: 'AMQP (RabbitMQ)' } },
  { port: 5900, proto: 'TCP', name: 'vnc', aliases: [], meaning: { ja: 'VNC', en: 'VNC' } },
  { port: 6379, proto: 'TCP', name: 'redis', aliases: [], meaning: { ja: 'Redis', en: 'Redis' } },
  { port: 6443, proto: 'TCP', name: 'kubernetes', aliases: ['k8s', 'kube-apiserver'], meaning: { ja: 'Kubernetes API サーバー', en: 'Kubernetes API server' } },
  { port: 8080, proto: 'TCP', name: 'http-alt', aliases: [], meaning: { ja: 'HTTP の代替（開発・プロキシ）', en: 'alternative HTTP (development, proxies)' } },
  { port: 8443, proto: 'TCP', name: 'https-alt', aliases: [], meaning: { ja: 'HTTPS の代替', en: 'alternative HTTPS' } },
  { port: 9092, proto: 'TCP', name: 'kafka', aliases: [], meaning: { ja: 'Apache Kafka', en: 'Apache Kafka' } },
  { port: 9200, proto: 'TCP', name: 'elasticsearch', aliases: [], meaning: { ja: 'Elasticsearch', en: 'Elasticsearch' } },
  { port: 9418, proto: 'TCP', name: 'git', aliases: [], meaning: { ja: 'Git プロトコル', en: 'Git protocol' } },
  { port: 11211, proto: 'TCP', name: 'memcached', aliases: [], meaning: { ja: 'Memcached', en: 'Memcached' } },
  { port: 27017, proto: 'TCP', name: 'mongodb', aliases: ['mongo'], meaning: { ja: 'MongoDB', en: 'MongoDB' } },
  { port: 51820, proto: 'UDP', name: 'wireguard', aliases: [], meaning: { ja: 'WireGuard', en: 'WireGuard' } },
]

const portLine = (p: Port, lang: Lang) =>
  `${String(p.port).padStart(5, ' ')}/${p.proto.padEnd(7, ' ')} ${p.name}${p.aliases.length > 0 ? ` (${p.aliases.join(', ')})` : ''}: ${pick(lang, p.meaning)}`

const PORT_TEXT: Texts = {
  ja: '0〜65535 のポート番号（例: 5432）かサービス名（例: ssh）',
  en: 'a port number from 0 to 65535 (e.g. 5432) or a service name (e.g. ssh)',
}

/** The range a port number falls in. */
const portRange = (n: number, lang: Lang) =>
  n <= 1023
    ? lang === 'ja' ? 'ウェルノウンポート（0〜1023）' : 'well-known ports (0 to 1023)'
    : n <= 49151
      ? lang === 'ja' ? '登録済みポート（1024〜49151）' : 'registered ports (1024 to 49151)'
      : lang === 'ja' ? '動的・プライベートポート（49152〜65535）' : 'dynamic or private ports (49152 to 65535)'

/** The service on a port, the port of a service, or (with no argument) the table. */
export const portNumbers = (input: LocalInput): LocalOutput => {
  const { lang } = input
  const text = textOf(input.arg)
  if (text === undefined) return invalid(lang, PORT_TEXT)
  const q = text.toLowerCase()
  if (q === '') {
    return { text: [lang === 'ja' ? '主なポート番号:' : 'Common ports:', ...PORTS.map(p => portLine(p, lang))].join('\n') }
  }
  if (/^\d+$/.test(q)) {
    const n = Number(q)
    if (n > 65535) return { error: lang === 'ja' ? `ポート番号は 0〜65535 です: ${text}` : `Port numbers run from 0 to 65535: ${text}` }
    const found = PORTS.filter(p => p.port === n)
    const range = portRange(n, lang)
    if (found.length === 0) {
      return { text: lang === 'ja' ? `${n}: この表にはありません（${range}）。` : `${n}: not in this table (${range}).` }
    }
    return { text: [...found.map(p => portLine(p, lang)), lang === 'ja' ? `範囲: ${range}` : `Range: ${range}`].join('\n') }
  }
  const found = PORTS.filter(p => p.name === q || p.aliases.includes(q))
  if (found.length === 0) {
    return { error: lang === 'ja' ? `この表にないサービス名です: ${text}（${PORT_TEXT.ja}）` : `Not a service in this table: ${text} (give ${PORT_TEXT.en}).` }
  }
  return { text: found.map(p => portLine(p, lang)).join('\n') }
}
