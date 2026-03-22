"use client"

import * as React from "react"
import { convertFileSrc, isTauri } from "@tauri-apps/api/core"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import rehypeRaw from "rehype-raw"

type HetiMarkdownPreviewProps = {
  markdown: string
  repoPath: string | null
  relativePath: string | null
}

export type FrontMatterEntry = {
  key: string
  value: string
}

function transformHexoCodeblock(markdown: string): string {
  const source = markdown ?? ""
  return source.replace(
    /{%\s*codeblock(?:\s+([^\s%]+))?[^%]*%}\s*\n?([\s\S]*?)\n?\s*{%\s*endcodeblock\s*%}/g,
    (_match, language: string | undefined, code: string) => {
      const lang = (language ?? "").trim()
      const normalizedCode = code.replace(/^\n+|\n+$/g, "")
      return `\n\`\`\`${lang}\n${normalizedCode}\n\`\`\`\n`
    }
  )
}

export function extractFrontMatter(markdown: string): { content: string; meta: FrontMatterEntry[] } {
  const text = markdown ?? ""
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { content: text, meta: [] }
  }

  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== "---") {
    return { content: text, meta: [] }
  }

  const metaLines: string[] = []
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      const meta = parseMetaLines(metaLines)
      return { content: lines.slice(i + 1).join("\n"), meta }
    }
    metaLines.push(lines[i])
  }

  return { content: text, meta: [] }
}

function parseMetaLines(lines: string[]): FrontMatterEntry[] {
  const entries: FrontMatterEntry[] = []
  let currentKey: string | null = null
  let currentList: string[] = []

  const flushCurrentList = () => {
    if (!currentKey) {
      return
    }
    if (currentList.length > 0) {
      entries.push({ key: currentKey, value: currentList.join(", ") })
    }
    currentKey = null
    currentList = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    if (line.startsWith("- ") && currentKey) {
      currentList.push(line.slice(2).trim())
      continue
    }

    flushCurrentList()
    const splitIndex = line.indexOf(":")
    if (splitIndex === -1) {
      continue
    }

    const key = line.slice(0, splitIndex).trim()
    const value = line.slice(splitIndex + 1).trim()
    if (!key) {
      continue
    }

    if (value) {
      entries.push({ key, value })
    } else {
      currentKey = key
      currentList = []
    }
  }

  flushCurrentList()
  return entries
}

function normalizePath(input: string): string {
  const isAbsolute = input.startsWith("/")
  const parts = input.split("/").filter((part) => part.length > 0)
  const stack: string[] = []
  for (const part of parts) {
    if (part === ".") {
      continue
    }
    if (part === "..") {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `${isAbsolute ? "/" : ""}${stack.join("/")}`
}

function resolveImageSrc(
  src: string,
  repoPath: string | null,
  relativePath: string | null
): string {
  if (!src) {
    return src
  }
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:") || src.startsWith("blob:")) {
    return src
  }
  if (!repoPath || !relativePath) {
    return src
  }

  const normalizedRepo = repoPath.replace(/\/+$/, "")
  let absolutePath = ""
  if (src.startsWith("/")) {
    absolutePath = normalizePath(`${normalizedRepo}/source${src}`)
  } else {
    const normalizedRelative = relativePath.replace(/\\/g, "/")
    const pathParts = normalizedRelative.split("/")
    const fileName = pathParts[pathParts.length - 1] ?? ""
    const baseDir = pathParts.slice(0, -1).join("/")
    const stem = fileName.replace(/\.[^.]+$/, "")
    // Hexo post_asset_folder: relative image paths live in _posts/<post-name>/*
    absolutePath = normalizePath(`${normalizedRepo}/${baseDir}/${stem}/${src}`)
  }

  return isTauri() ? convertFileSrc(absolutePath) : absolutePath
}

function coerceImageSource(src: string | Blob | null | undefined): string {
  if (typeof src === "string") {
    return src
  }
  if (src instanceof Blob) {
    return URL.createObjectURL(src)
  }
  return ""
}

export function HetiMarkdownPreview({
  markdown,
  repoPath,
  relativePath,
}: HetiMarkdownPreviewProps) {
  const parsed = React.useMemo(() => {
    const fm = extractFrontMatter(markdown)
    return {
      ...fm,
      content: transformHexoCodeblock(fm.content),
    }
  }, [markdown])
  const articleRef = React.useRef<HTMLElement | null>(null)
  const spacingKey = React.useMemo(
    () => `${relativePath ?? ""}:${parsed.content.length}`,
    [relativePath, parsed.content.length]
  )

  React.useEffect(() => {
    const article = articleRef.current
    if (!article) {
      return
    }

    if (article.dataset.hetiSpacedKey === spacingKey) {
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        const mod = await import("./heti/js/heti-addon.js")
        if (cancelled) {
          return
        }
        const Heti = mod.default
        const heti = new Heti()
        heti.spacingElement(article)
        article.dataset.hetiSpacedKey = spacingKey
      } catch {
        // ignore if heti addon fails in runtime
      }
    }
    run()

    return () => {
      cancelled = true
    }
  }, [spacingKey, parsed.content])

  return (
    <article ref={articleRef} className="heti p-6 leading-7 mx-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex, rehypeHighlight]}
        components={{
          img: ({ src, alt }: { src?: string | Blob; alt?: string }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveImageSrc(coerceImageSource(src), repoPath, relativePath)}
              alt={alt ?? ""}
              className="my-4 h-auto max-w-full rounded-md"
            />
          ),
        }}
      >
        {parsed.content}
      </ReactMarkdown>
    </article>
  )
}
