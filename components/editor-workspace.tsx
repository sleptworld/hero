"use client"

import * as React from "react"
import { Save, Send } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { join } from "@tauri-apps/api/path"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { toast } from "sonner"

import { RichTextEditor } from "@/components/rich-text-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { readOnboardingState } from "@/lib/onboarding-storage"

type SaveTarget = "publish" | "draft"
type SaveOptions = {
  silent?: boolean
}

type SaveHexoPostResult = {
  relative_path: string
  title: string
  front_matter: string
}

function parseFrontMatter(markdown: string): { frontMatter: string | null; body: string } {
  const text = markdown ?? ""
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { frontMatter: null, body: text }
  }
  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== "---") {
    return { frontMatter: null, body: text }
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      return {
        frontMatter: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      }
    }
  }
  return { frontMatter: null, body: text }
}

function extractTitle(frontMatter: string | null): string {
  if (!frontMatter) {
    return ""
  }
  const match = frontMatter.match(/^\s*title\s*:\s*(.+)\s*$/m)
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? ""
}

function parseFrontMatterList(frontMatter: string | null, field: "tags" | "categories"): string[] {
  if (!frontMatter) {
    return []
  }

  const source = frontMatter
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  const blockMatch = source.match(new RegExp(`^\\s*${escapedField}\\s*:\\s*$([\\s\\S]*?)(?=^\\S|\\Z)`, "m"))
  if (blockMatch?.[1]) {
    const values = blockMatch[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim().replace(/^['"]|['"]$/g, ""))
      .filter((line) => line.length > 0)
    if (values.length > 0) {
      return values
    }
  }

  const inlineMatch = source.match(new RegExp(`^\\s*${escapedField}\\s*:\\s*(.+)\\s*$`, "m"))
  if (!inlineMatch?.[1]) {
    return []
  }

  const rawValue = inlineMatch[1].trim()
  if (!rawValue) {
    return []
  }
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    return rawValue
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter((item) => item.length > 0)
  }
  return rawValue
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter((item) => item.length > 0)
}

export function EditorWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [repoPath, setRepoPath] = React.useState<string | null>(null)
  const [docKey, setDocKey] = React.useState(0)
  const [relativePath, setRelativePath] = React.useState<string | null>(null)
  const [frontMatter, setFrontMatter] = React.useState<string | null>(null)
  const [seedTitle, setSeedTitle] = React.useState("")
  const [seedMarkdown, setSeedMarkdown] = React.useState("")
  const [draftTitle, setDraftTitle] = React.useState("")
  const [draftMarkdown, setDraftMarkdown] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [confirmLeaveOpen, setConfirmLeaveOpen] = React.useState(false)
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false)
  const [publishTags, setPublishTags] = React.useState("")
  const [publishCategories, setPublishCategories] = React.useState("")
  const autosaveTimerRef = React.useRef<number | null>(null)

  const pathFromQuery = searchParams.get("path")
  const isNewFromQuery = searchParams.get("new") === "1"

  const isDirty = React.useMemo(() => {
    return (draftTitle ?? "").trim() !== (seedTitle ?? "").trim() || (draftMarkdown ?? "").trim() !== (seedMarkdown ?? "").trim()
  }, [draftMarkdown, draftTitle, seedMarkdown, seedTitle])

  const normalizeTextContent = React.useCallback(async (value: string | Blob): Promise<string> => {
    if (typeof value === "string") {
      return value
    }
    return value.text()
  }, [])

  React.useEffect(() => {
    let active = true
    const run = async () => {
      try {
        const state = await readOnboardingState()
        if (active) {
          setRepoPath(state.profile?.repo ?? null)
        }
      } catch {
        if (active) {
          setRepoPath(null)
        }
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        if (!repoPath || !isTauri() || !pathFromQuery || isNewFromQuery) {
          if (active) {
            setFrontMatter(null)
            setRelativePath(null)
            setSeedTitle("")
            setSeedMarkdown("")
            setDraftTitle("")
            setDraftMarkdown("")
            setDocKey((k) => k + 1)
          }
          return
        }

        const absolutePath = await join(repoPath, pathFromQuery)
        const content = await readTextFile(absolutePath)
        const text = await normalizeTextContent(content)
        if (!active) {
          return
        }
        const parsed = parseFrontMatter(text)
        const loadedTitle = extractTitle(parsed.frontMatter)
        setFrontMatter(parsed.frontMatter)
        setRelativePath(pathFromQuery)
        setSeedTitle(loadedTitle)
        setSeedMarkdown(parsed.body)
        setDraftTitle(loadedTitle)
        setDraftMarkdown(parsed.body)
        setDocKey((k) => k + 1)
      } catch (err) {
        if (active) {
          toast.error(err instanceof Error ? err.message : "Failed to open post.")
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [repoPath, pathFromQuery, isNewFromQuery, normalizeTextContent])

  const navigateBack = React.useCallback(() => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push("/list")
    }
  }, [router])

  const handleSave = React.useCallback(
    async (
      target: SaveTarget,
      metadata?: { tags?: string[]; categories?: string[] },
      options?: SaveOptions
    ) => {
      if (!repoPath || !isTauri()) {
        if (!options?.silent) {
          toast.error("Tauri runtime and repository are required.")
        }
        return false
      }
      setSaving(true)
      try {
        const result = await invoke<SaveHexoPostResult>("save_hexo_post", {
          repoPath,
          relativePath,
          title: draftTitle,
          markdown: draftMarkdown,
          frontMatter,
          target,
          tags: metadata?.tags,
          categories: metadata?.categories,
        })

        setRelativePath(result.relative_path)
        setFrontMatter(result.front_matter)
        setSeedTitle(result.title)
        setSeedMarkdown(draftMarkdown)
        setDraftTitle(result.title)
        if (!options?.silent) {
          toast.success(target === "publish" ? "Published" : "Saved to drafts")
        }

        const targetUrl = `/editor?path=${encodeURIComponent(result.relative_path)}`
        router.replace(targetUrl)
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save post.")
        return false
      } finally {
        setSaving(false)
      }
    },
    [draftMarkdown, draftTitle, frontMatter, relativePath, repoPath, router]
  )

  const parseCsv = React.useCallback((value: string): string[] => {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  }, [])

  const openPublishDialog = React.useCallback(() => {
    const currentTags = parseFrontMatterList(frontMatter, "tags")
    const currentCategories = parseFrontMatterList(frontMatter, "categories")
    setPublishTags(currentTags.join(", "))
    setPublishCategories(currentCategories.join(", "))
    setPublishDialogOpen(true)
  }, [frontMatter])

  const isCreateMode = isNewFromQuery || !relativePath
  const getAutoSaveTarget = React.useCallback((path: string): SaveTarget => {
    return path.startsWith("source/_posts/") ? "publish" : "draft"
  }, [])

  React.useEffect(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }

    if (loading || isCreateMode || !relativePath || !isDirty || saving || !repoPath || !isTauri()) {
      return
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      const target = getAutoSaveTarget(relativePath)
      void handleSave(target, undefined, { silent: true })
    }, 1200)

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [getAutoSaveTarget, handleSave, isCreateMode, isDirty, loading, relativePath, repoPath, saving])

  React.useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" || event.defaultPrevented || event.isComposing) {
        return
      }

      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTextInput =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true ||
        target?.closest("[contenteditable='true']") !== null

      if (!isTextInput) {
        event.preventDefault()
      }
    }

    window.addEventListener("keydown", onWindowKeyDown, true)
    return () => window.removeEventListener("keydown", onWindowKeyDown, true)
  }, [])

  return (
    <main className="h-svh min-h-svh bg-background">
      {!loading ? (
        <>
          <RichTextEditor
            initialTitle={seedTitle}
            initialMarkdown={seedMarkdown}
            docKey={`${relativePath ?? "new"}-${docKey}`}
            onTitleChange={setDraftTitle}
            onMarkdownChange={setDraftMarkdown}
            onBack={() => {
              if (!isDirty) {
                navigateBack()
                return
              }
              setConfirmLeaveOpen(true)
            }}
          />
          <div className="pointer-events-none fixed right-6 bottom-6 z-50">
            {isCreateMode ? (
              <div className="pointer-events-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleSave("draft")}
                  disabled={saving || !repoPath}
                >
                  <Save className="size-4" />
                  Save to Drafts
                </Button>
                <Button onClick={openPublishDialog} disabled={saving || !repoPath}>
                  <Send className="size-4" />
                  Publish
                </Button>
              </div>
            ) : (
              <Button
                className="pointer-events-auto shadow-lg"
                size="icon-lg"
                onClick={openPublishDialog}
                disabled={saving || !repoPath}
                aria-label={saving ? "Saving..." : "保存"}
                title={saving ? "Saving..." : "保存"}
              >
                <Save className="size-4" />
              </Button>
            )}
          </div>
        </>
      ) : null}

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              Save current content to drafts before leaving, or delete these changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmLeaveOpen(false)
                navigateBack()
              }}
            >
              Delete
            </AlertDialogAction>
            <AlertDialogAction
              onClick={async () => {
                const ok = await handleSave("draft")
                if (ok) {
                  setConfirmLeaveOpen(false)
                  navigateBack()
                }
              }}
            >
              Save to Drafts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Settings</DialogTitle>
            <DialogDescription>Set tags and categories for this post before publishing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Tags</p>
              <Input
                placeholder="react, tauri, hexo"
                value={publishTags}
                onChange={(event) => setPublishTags(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Categories</p>
              <Input
                placeholder="engineering, notes"
                value={publishCategories}
                onChange={(event) => setPublishCategories(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const ok = await handleSave("publish", {
                  tags: parseCsv(publishTags),
                  categories: parseCsv(publishCategories),
                })
                if (ok) {
                  setPublishDialogOpen(false)
                }
              }}
              disabled={saving || !repoPath}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
