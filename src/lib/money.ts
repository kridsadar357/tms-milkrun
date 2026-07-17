/** Money formatting + Thai/English amount-in-words for printed documents. */

const TH_DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const TH_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน']

/** Convert an integer (0..999999999999) to Thai words. */
function thaiInteger(nStr: string): string {
  if (nStr === '0') return 'ศูนย์'
  // Handle millions groups recursively (ล้าน).
  if (nStr.length > 6) {
    const head = nStr.slice(0, nStr.length - 6)
    const tail = nStr.slice(nStr.length - 6)
    const tailWords = tail === '000000' ? '' : thaiInteger(String(Number(tail)))
    return thaiInteger(String(Number(head))) + 'ล้าน' + tailWords
  }
  let out = ''
  const digits = nStr.split('').map(Number)
  const len = digits.length
  for (let i = 0; i < len; i++) {
    const d = digits[i]
    const place = len - i - 1 // 0=units, 1=tens ...
    if (d === 0) continue
    if (place === 0 && d === 1 && len > 1) {
      out += 'เอ็ด'
    } else if (place === 1 && d === 1) {
      out += 'สิบ'
    } else if (place === 1 && d === 2) {
      out += 'ยี่สิบ'
    } else {
      out += TH_DIGITS[d] + TH_PLACES[place]
    }
  }
  return out
}

/** Thai baht text, e.g. 1234.50 → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์". */
export function bahtText(amount: number): string {
  const rounded = Math.round(amount * 100)
  const baht = Math.floor(rounded / 100)
  const satang = rounded % 100
  const bahtWords = thaiInteger(String(baht)) + 'บาท'
  if (satang === 0) return bahtWords + 'ถ้วน'
  return bahtWords + thaiInteger(String(satang)) + 'สตางค์'
}

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen']
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function enHundreds(n: number): string {
  let out = ''
  if (n >= 100) {
    out += EN_ONES[Math.floor(n / 100)] + ' hundred'
    n %= 100
    if (n) out += ' '
  }
  if (n >= 20) {
    out += EN_TENS[Math.floor(n / 10)]
    if (n % 10) out += '-' + EN_ONES[n % 10]
  } else if (n > 0) {
    out += EN_ONES[n]
  }
  return out
}

/** English amount, e.g. 1234.50 → "One Thousand Two Hundred Thirty-Four Baht and Fifty Satang". */
export function bahtTextEn(amount: number): string {
  const rounded = Math.round(amount * 100)
  let baht = Math.floor(rounded / 100)
  const satang = rounded % 100
  if (baht === 0) return satang ? `${cap(enHundreds(satang))} Satang` : 'Zero Baht'
  const groups = ['', ' thousand', ' million', ' billion']
  const parts: string[] = []
  let g = 0
  while (baht > 0) {
    const chunk = baht % 1000
    if (chunk) parts.unshift(enHundreds(chunk) + groups[g])
    baht = Math.floor(baht / 1000)
    g++
  }
  const words = cap(parts.join(' ')) + ' Baht'
  return satang ? `${words} and ${cap(enHundreds(satang))} Satang` : `${words} Only`
}

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** THB formatting with thousands separators and 2 decimals. */
export function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
