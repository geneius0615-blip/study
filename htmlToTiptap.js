
import { parseFragment } from 'parse5'

// 위험 요소: 하위 내용도 함께 제거
const BLOCKED = new Set([
  'script', 'style', 'iframe', 'object', 'embed',
  'svg', 'math', 'form', 'input', 'button',
  'textarea', 'select', 'template', 'noscript',
  'meta', 'link', 'video', 'audio', 'canvas',
  'base', 'picture', 'source'
])

const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'figure',
  'figcaption', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'ul', 'ol', 'blockquote',
  'pre', 'hr', 'table'
])

const MARKS = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike',
  code: 'code'
}

const children = node => node.childNodes || []

function attr(node, name) {
  return node.attrs?.find(a => a.name === name)?.value
}

// 링크: HTTP(S)만 허용
function safeLink(href) {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) {
    return null
  }

  try {
    const url = new URL(href, window.location.origin)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null
    }

    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

// 이미지: 동일 출처 또는 승인된 이미지 서버만 허용
function safeImageSrc(src) {
  if (!src || /[\u0000-\u001f\u007f]/.test(src)) {
    return null
  }

  try {
    const url = new URL(src, window.location.origin)

    const approvedCdn =
      import.meta.env.VITE_BOARD_IMAGE_ORIGIN

    const allowedOrigins = [
      window.location.origin,
      ...(approvedCdn ? [new URL(approvedCdn).origin] : [])
    ]

    if (!allowedOrigins.includes(url.origin)) {
      return null
    }

    // HTTP는 동일 출처 개발환경에서만 허용
    const validProtocol =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
       url.origin === window.location.origin)

    if (!validProtocol || url.username || url.password) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

function imageNode(node) {
  const src = safeImageSrc(attr(node, 'src'))
  if (!src) return null

  return {
    type: 'image',
    attrs: {
      src,
      alt: (attr(node, 'alt') || '').slice(0, 300),
      title: (attr(node, 'title') || '').slice(0, 300)
    }
  }
}

// 인라인 노드 변환: 텍스트, 이미지, 서식
function inlineNodes(node, marks = []) {
  if (node.nodeName === '#text') {
    if (!node.value) return []

    return [{
      type: 'text',
      text: node.value,
      ...(marks.length ? { marks } : {})
    }]
  }

  const tag = node.tagName

  if (BLOCKED.has(tag)) return []

  if (tag === 'img') {
    const image = imageNode(node)
    return image ? [image] : []
  }

  if (tag === 'br') {
    return [{ type: 'hardBreak' }]
  }

  if (tag === 'table') return []

  let nextMarks = marks

  if (MARKS[tag] &&
      !marks.some(m => m.type === MARKS[tag])) {
    nextMarks = [
      ...marks,
      { type: MARKS[tag] }
    ]
  }

  if (tag === 'a') {
    const href = safeLink(attr(node, 'href'))

    if (href) {
      nextMarks = [
        ...nextMarks.filter(m => m.type !== 'link'),
        { type: 'link', attrs: { href } }
      ]
    }
  }

  return children(node).flatMap(child =>
    inlineNodes(child, nextMarks)
  )
}

function paragraph(content = []) {
  return content.length
    ? { type: 'paragraph', content }
    : { type: 'paragraph' }
}

// 이미지와 문단을 유효한 블록 구조로 분리
function textBlocks(nodes, headingLevel = null) {
  const mixed = nodes.flatMap(n => inlineNodes(n))
  const result = []
  let buffer = []

  function flush() {
    if (!buffer.length) return

    result.push(headingLevel
      ? {
          type: 'heading',
          attrs: { level: headingLevel },
          content: buffer
        }
      : paragraph(buffer))

    buffer = []
  }

  for (const item of mixed) {
    if (item.type === 'image') {
      flush()
      result.push(item)
    } else {
      buffer.push(item)
    }
  }

  flush()

  return result.length
    ? result
    : [paragraph()]
}

function plainText(node) {
  if (node.nodeName === '#text') {
    return node.value
  }

  if (BLOCKED.has(node.tagName)) return ''

  if (node.tagName === 'br') return '\n'

  return children(node).map(plainText).join('')
}

// 테이블 내 tr 수집
function collectRows(node) {
  const rows = []

  function walk(current) {
    for (const child of children(current)) {
      if (child.tagName === 'tr') {
        rows.push(child)
      } else if (
        ['thead', 'tbody', 'tfoot'].includes(child.tagName)
      ) {
        walk(child)
      }
    }
  }

  walk(node)
  return rows.slice(0, 100)
}

function safeSpan(value) {
  const number = Number(value || 1)

  return Number.isInteger(number) &&
    number >= 1 && number <= 20
    ? number
    : 1
}

// table -> tableRow -> tableCell/tableHeader
function tableNode(node) {
  const rows = collectRows(node).map(row => {
    const cells = children(row)
      .filter(c => ['td', 'th'].includes(c.tagName))
      .slice(0, 30)
      .map(cell => {
        const content = toBlocks(children(cell))

        return {
          type: cell.tagName === 'th'
            ? 'tableHeader'
            : 'tableCell',
          attrs: {
            colspan: safeSpan(attr(cell, 'colspan')),
            rowspan: safeSpan(attr(cell, 'rowspan'))
          },
          content: content.length
            ? content
            : [paragraph()]
        }
      })

    return cells.length
      ? { type: 'tableRow', content: cells }
      : null
  }).filter(Boolean)

  return rows.length
    ? { type: 'table', content: rows }
    : null
}

function toBlocks(nodes) {
  const result = []
  let pending = []

  function flush() {
    if (pending.length) {
      const meaningful = pending.some(
        item => item.type !== 'text' ||
          item.text.trim().length > 0
      )

      if (meaningful) {
        result.push(...splitMixed(pending))
      }
    }
    pending = []
  }

  function splitMixed(items) {
    const blocks = []
    let buffer = []

    const write = () => {
      if (buffer.length) {
        blocks.push(paragraph(buffer))
        buffer = []
      }
    }

    for (const item of items) {
      if (item.type === 'image') {
        write()
        blocks.push(item)
      } else {
        buffer.push(item)
      }
    }

    write()
    return blocks
  }

  for (const node of nodes) {
    const tag = node.tagName

    if (BLOCKED.has(tag)) continue

    if (tag === 'img') {
      flush()
      const image = imageNode(node)
      if (image) result.push(image)
      continue
    }

    if (!BLOCKS.has(tag)) {
      pending.push(...inlineNodes(node))
      continue
    }

    flush()

    if (tag === 'p') {
      result.push(...textBlocks(children(node)))
    } else if (/^h[1-6]$/.test(tag)) {
      result.push(
        ...textBlocks(children(node), Number(tag[1]))
      )
    } else if (tag === 'table') {
      const table = tableNode(node)
      if (table) result.push(table)
    } else if (tag === 'ul' || tag === 'ol') {
      const items = children(node)
        .filter(n => n.tagName === 'li')
        .map(li => {
          const content = toBlocks(children(li))

          if (content[0]?.type !== 'paragraph') {
            content.unshift(paragraph())
          }

          return {
            type: 'listItem',
            content
          }
        })

      if (items.length) {
        const list = {
          type: tag === 'ul'
            ? 'bulletList'
            : 'orderedList',
          content: items
        }

        if (tag === 'ol') {
          const start = Number(attr(node, 'start'))
          if (Number.isInteger(start) &&
              start > 1 && start <= 10000) {
            list.attrs = { start }
          }
        }

        result.push(list)
      }
    } else if (tag === 'blockquote') {
      const content = toBlocks(children(node))
      result.push({
        type: 'blockquote',
        content: content.length
          ? content
          : [paragraph()]
      })
    } else if (tag === 'pre') {
      const value = plainText(node)
      result.push({
        type: 'codeBlock',
        ...(value ? {
          content: [{ type: 'text', text: value }]
        } : {})
      })
    } else if (tag === 'hr') {
      result.push({ type: 'horizontalRule' })
    } else {
      result.push(...toBlocks(children(node)))
    }
  }

  flush()
  return result
}

export function htmlToTiptap(html) {
  if (typeof html !== 'string') {
    throw new Error('HTML 문자열이 필요합니다.')
  }

  // 과도한 입력으로 인한 브라우저 부하 방지
  if (html.length > 2_000_000) {
    throw new Error('게시글 크기 제한을 초과했습니다.')
  }

  const tree = parseFragment(html)
  const content = toBlocks(tree.childNodes)

  return {
    type: 'doc',
    content: content.length
      ? content
      : [paragraph()]
  }
}
