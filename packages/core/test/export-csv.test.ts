import { describe, expect, it } from 'vitest'
import {
  CSV_EOL,
  csvDocument,
  csvEscape,
  csvRow,
  guardSpreadsheetInjection,
} from '../src/export/index.js'

describe('csvEscape (RFC 4180)', () => {
  it('passes plain fields through unquoted', () => {
    expect(csvEscape('hello world')).toBe('hello world')
    expect(csvEscape('')).toBe('')
    expect(csvEscape("it's fine")).toBe("it's fine")
  })

  it('quotes fields containing commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })

  it('quotes and doubles embedded quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('"')).toBe('""""')
  })

  it('quotes fields containing CR or LF', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
    expect(csvEscape('a\rb')).toBe('"a\rb"')
  })
})

describe('guardSpreadsheetInjection', () => {
  it('prefixes formula-leading characters with a single quote', () => {
    expect(guardSpreadsheetInjection('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(guardSpreadsheetInjection('+1234')).toBe("'+1234")
    expect(guardSpreadsheetInjection('-cmd')).toBe("'-cmd")
    expect(guardSpreadsheetInjection('@import')).toBe("'@import")
  })

  it('leaves ordinary fields alone', () => {
    expect(guardSpreadsheetInjection('peony-75')).toBe('peony-75')
    expect(guardSpreadsheetInjection('a=b')).toBe('a=b')
    expect(guardSpreadsheetInjection('')).toBe('')
  })

  it('composes with RFC quoting (guard first, then escape)', () => {
    expect(csvRow([guardSpreadsheetInjection('=a,b')])).toBe('"\'=a,b"')
  })
})

describe('csvRow / csvDocument', () => {
  it('joins mixed field types with commas', () => {
    expect(csvRow(['a', 1, 2.5, true, null, undefined, 'z'])).toBe('a,1,2.5,true,,,z')
  })

  it('emits CRLF-separated records with trailing CRLF', () => {
    const doc = csvDocument([
      ['h1', 'h2'],
      ['a', 'b,c'],
    ])
    expect(doc).toBe(`h1,h2${CSV_EOL}a,"b,c"${CSV_EOL}`)
  })
})
