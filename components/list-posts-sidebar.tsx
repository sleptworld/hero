"use client"

import * as React from "react"
import { EyeOff, FileClock, FileText, Filter } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
} from "@/components/ui/sidebar"

export type HexoPostItem = {
  title: string
  description: string
  relative_path: string
  kind: "post" | "draft" | "unpublished" | string
}

type ListPostsSidebarProps = {
  loading: boolean
  error: string | null
  posts: HexoPostItem[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

export function ListPostsSidebar({
  loading,
  error,
  posts,
  selectedPath,
  onSelect,
}: ListPostsSidebarProps) {
  const [filter, setFilter] = React.useState<"all" | "post" | "draft" | "unpublished">("all")
  const [query, setQuery] = React.useState("")

  const visiblePosts = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return posts.filter((post) => {
      if (filter !== "all" && post.kind !== filter) {
        return false
      }
      if (!q) {
        return true
      }
      return (
        post.title.toLowerCase().includes(q) ||
        post.description.toLowerCase().includes(q) ||
        post.relative_path.toLowerCase().includes(q)
      )
    })
  }, [filter, posts, query])

  const filterLabel = React.useMemo(() => {
    if (filter === "all") {
      return "All"
    }
    if (filter === "post") {
      return "Posts"
    }
    if (filter === "draft") {
      return "Drafts"
    }
    return "Unpublished"
  }, [filter])

  return (
    <Sidebar collapsible="none" className="hidden flex-1 md:flex">
      <SidebarHeader className="gap-1 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-base font-medium text-foreground">Content</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Filter content" title="Filter content">
                <Filter className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 min-w-40">
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setFilter("post")}>
                <FileText className="size-4" />
                Posts
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilter("draft")}>
                <FileClock className="size-4" />
                Drafts
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilter("unpublished")}>
                <EyeOff className="size-4" />
                Unpublished
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilter("all")}>All</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="text-xs text-muted-foreground">{visiblePosts.length} items · {filterLabel}</div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title or description"
          className="mt-1"
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-0">
          <SidebarGroupContent>
            {loading ? <div className="p-4 text-sm text-muted-foreground">Loading posts...</div> : null}
            {error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
            {!loading && !error && visiblePosts.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No posts found.</div>
            ) : null}
            {!loading && !error
              ? visiblePosts.map((post) => (
                  <button
                    key={post.relative_path}
                    onClick={() => onSelect(post.relative_path)}
                    className={`block w-full border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-sidebar-accent ${
                      selectedPath === post.relative_path ? "bg-sidebar-accent" : ""
                    }`}
                  >
                    <div className="font-medium text-foreground">{post.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {post.description || "No description"}
                    </div>
                  </button>
                ))
              : null}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
