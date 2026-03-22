"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, MoreHorizontal } from "lucide-react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { join } from "@tauri-apps/api/path"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { toast } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import { extractFrontMatter, HetiMarkdownPreview } from "@/components/heti-markdown-preview"
import { HexoPostItem, ListPostsSidebar } from "@/components/list-posts-sidebar"
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { readOnboardingState } from "@/lib/onboarding-storage"

export function ListWorkspace() {
  const normalizeTextContent = React.useCallback(async (value: string | Blob): Promise<string> => {
    if (typeof value === "string") {
      return value
    }
    return value.text()
  }, [])

  const router = useRouter()
  const [repoPath, setRepoPath] = React.useState<string | null>(null)
  const [posts, setPosts] = React.useState<HexoPostItem[]>([])
  const [postsLoading, setPostsLoading] = React.useState(true)
  const [postsError, setPostsError] = React.useState<string | null>(null)

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [markdown, setMarkdown] = React.useState("")
  const [loadingDoc, setLoadingDoc] = React.useState(false)
  const [docError, setDocError] = React.useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)

  const loadPosts = React.useCallback(
    async (repo: string, keepSelectionPath?: string | null) => {
      const result = await invoke<HexoPostItem[]>("list_hexo_posts", { repoPath: repo })
      setPosts(result)
      const preferred = keepSelectionPath ?? null
      const stillExists = preferred ? result.some((item) => item.relative_path === preferred) : false
      setSelectedPath(stillExists ? preferred : (result[0]?.relative_path ?? null))
      setPostsError(null)
    },
    []
  )

  React.useEffect(() => {
    let active = true
    const run = async () => {
      try {
        if (!isTauri()) {
          if (active) {
            setPostsError("Tauri runtime is required.")
          }
          return
        }
        const state = await readOnboardingState()
        const repo = state.profile?.repo
        if (!repo) {
          if (active) {
            setPostsError("Repository is not configured.")
          }
          return
        }
        if (!active) {
          return
        }
        setRepoPath(repo)
        await loadPosts(repo)
        setPostsError(null)
      } catch (error) {
        if (!active) {
          return
        }
        const message = error instanceof Error ? error.message : "Failed to load posts."
        setPostsError(message)
      } finally {
        if (active) {
          setPostsLoading(false)
        }
      }
    }
    run()
    return () => {
      active = false
    }
  }, [loadPosts])

  React.useEffect(() => {
    let active = true
    const run = async () => {
      if (!repoPath || !selectedPath) {
        return
      }
      setLoadingDoc(true)
      setDocError(null)
      try {
        const fullPath = await join(repoPath, selectedPath)
        const content = await readTextFile(fullPath)
        const text = await normalizeTextContent(content)
        if (!active) {
          return
        }
        setMarkdown(text)
      } catch (error) {
        if (!active) {
          return
        }
        const message = error instanceof Error ? error.message : "Failed to open document."
        setDocError(message)
        setMarkdown("")
      } finally {
        if (active) {
          setLoadingDoc(false)
        }
      }
    }
    run()
    return () => {
      active = false
    }
  }, [repoPath, selectedPath, normalizeTextContent])

  const breadcrumbTitle = React.useMemo(() => {
    const parsed = extractFrontMatter(markdown)
    const found = parsed.meta.find((entry) => entry.key.toLowerCase() === "title")
    return found?.value || "Untitled"
  }, [markdown])

  return (
    <SidebarProvider
      className="h-svh min-h-svh"
      style={
        {
          "--sidebar-width": "350px",
        } as React.CSSProperties
      }
    >
      <AppSidebar>
        <ListPostsSidebar
          loading={postsLoading}
          error={postsError}
          posts={posts}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
        />
      </AppSidebar>
      <SidebarInset className="h-svh min-h-svh">
        <header className="flex shrink-0 items-center gap-2 border-b px-4  h-17">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="#">Posts</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{breadcrumbTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto">
            <ButtonGroup>
              <Button asChild size="sm" variant="outline" disabled={!selectedPath}>
                <Link href={selectedPath ? `/editor?path=${encodeURIComponent(selectedPath)}` : "/editor"}>
                  Edit
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="outline" aria-label="More actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 min-w-44">
                  <DropdownMenuLabel>More Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => router.push("/editor?new=1")}>
                    New Post
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!selectedPath}
                    onClick={async () => {
                      if (selectedPath) {
                        try {
                          await navigator.clipboard.writeText(selectedPath)
                          toast.success("Post path copied")
                        } catch {
                          toast.error("Failed to copy post path")
                        }
                      }
                    }}
                  >
                    Copy Post Path
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!breadcrumbTitle}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(breadcrumbTitle)
                        toast.success("Title copied")
                      } catch {
                        toast.error("Failed to copy title")
                      }
                    }}
                  >
                    Copy Title
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!selectedPath || !repoPath}
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    Delete Post
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </div>
        </header>



        <div className="flex h-full min-h-0 flex-1 flex-col p-4 md:p-6">
          {loadingDoc ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                <span>Loading document...</span>
              </div>
            </div>
          ) : null}
          {docError ? <div className="text-sm text-destructive">{docError}</div> : null}

          {!loadingDoc && selectedPath ? (
            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full w-full">
                <div className="mx-auto w-full max-w-3xl space-y-3">
                  {/* <h1 className="heti px-1 text-4xl">{title}</h1> */}
                  <HetiMarkdownPreview
                    markdown={markdown}
                    repoPath={repoPath}
                    relativePath={selectedPath}
                  />
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </div>
      </SidebarInset>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected markdown file from the repository.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!repoPath || !selectedPath) {
                  return
                }
                try {
                  await invoke("delete_hexo_post", { repoPath, relativePath: selectedPath })
                  await loadPosts(repoPath, null)
                  setMarkdown("")
                  setDeleteDialogOpen(false)
                  toast.success("Post deleted")
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to delete post"
                  toast.error(message)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
