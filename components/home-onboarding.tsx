"use client"

import * as React from "react"
import { Sparkles, UserRound, Rocket, CheckCircle2, GitBranch, FolderOpen, Loader2 } from "lucide-react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { exists } from "@tauri-apps/plugin-fs"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type OnboardingProfile,
  normalizeThemePreference,
  readOnboardingState,
  saveOnboardingState,
} from "@/lib/onboarding-storage"

type OnboardingState = OnboardingProfile

type HomeOnboardingProps = {
  showWelcome?: boolean
  onlyOnboarding?: boolean
  onCompleted?: () => void
}

type HexoRepoOverview = {
  hexo_version: string | null
  post_count: number
  draft_count: number
  tag_count: number
  repo_path: string
}

type HexoSyncStatus = {
  has_remote: boolean
  has_changes: boolean
  has_unpushed_commits: boolean
  branch: string | null
}

type HexoSyncResult = {
  committed: boolean
  pushed: boolean
}

export function HomeOnboarding({
  showWelcome = true,
  onlyOnboarding = false,
  onCompleted,
}: HomeOnboardingProps) {
  const [mounted, setMounted] = React.useState(false)
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false)
  const [step, setStep] = React.useState(1)
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [overview, setOverview] = React.useState<HexoRepoOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = React.useState(false)
  const [overviewError, setOverviewError] = React.useState<string | null>(null)
  const [syncStatus, setSyncStatus] = React.useState<HexoSyncStatus | null>(null)
  const [syncLoading, setSyncLoading] = React.useState(false)
  const [syncError, setSyncError] = React.useState<string | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const [state, setState] = React.useState<OnboardingState>({
    username: "",
    repoType: "remote",
    repo: "",
    theme: "system",
  })

  React.useEffect(() => {
    let active = true
    setMounted(true)
    readOnboardingState().then((data) => {
      if (!active) {
        return
      }
      if (data.profile) {
        setState(data.profile)
      }
      setNeedsOnboarding(!data.completed)
    })
    return () => {
      active = false
    }
  }, [])

  const loadOverview = React.useCallback(async () => {
    if (!mounted || needsOnboarding || !state.repo || !isTauri()) {
      return
    }
    setOverviewLoading(true)
    setOverviewError(null)
    try {
      const result = await invoke<HexoRepoOverview>("get_hexo_repo_overview", { repoPath: state.repo })
      setOverview(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load repository overview."
      setOverviewError(message)
    } finally {
      setOverviewLoading(false)
    }
  }, [mounted, needsOnboarding, state.repo])

  React.useEffect(() => {
    loadOverview()
  }, [loadOverview])

  const loadSyncStatus = React.useCallback(async () => {
    if (!mounted || needsOnboarding || !state.repo || !isTauri()) {
      return
    }
    setSyncLoading(true)
    setSyncError(null)
    try {
      const result = await invoke<HexoSyncStatus>("get_hexo_sync_status", { repoPath: state.repo })
      setSyncStatus(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load sync status."
      setSyncError(message)
      setSyncStatus(null)
    } finally {
      setSyncLoading(false)
    }
  }, [mounted, needsOnboarding, state.repo])

  React.useEffect(() => {
    loadSyncStatus()
  }, [loadSyncStatus])

  const canNextFromStep1 = state.username.trim().length > 0
  const canNextFromStep2 = state.repo.trim().length > 0
  const canFinish = state.theme.trim().length > 0
  const refreshSnapshot = React.useCallback(() => {
    loadOverview()
    loadSyncStatus()
  }, [loadOverview, loadSyncStatus])

  const syncRepo = async () => {
    if (!isTauri() || !state.repo || syncing) {
      return
    }
    setSyncing(true)
    setSyncError(null)
    try {
      const result = await invoke<HexoSyncResult>("sync_hexo_repo", { repoPath: state.repo })
      toast.success(result.committed ? "Committed and pushed successfully" : "Pushed successfully")
      refreshSnapshot()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync repository."
      setSyncError(message)
      toast.error(message)
    } finally {
      setSyncing(false)
    }
  }

  const finishOnboarding = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      let profileToSave: OnboardingProfile = state
      if (state.repoType === "remote") {
        if (!isTauri()) {
          throw new Error("Remote clone requires Tauri runtime.")
        }
        const clonedPath = await invoke<string>("clone_hexo_repo_to_documents", {
          remoteUrl: state.repo,
        })
        profileToSave = {
          ...state,
          remoteUrl: state.repo,
          repo: clonedPath,
        }
        setState(profileToSave)
      }

      await saveOnboardingState(profileToSave)
      setNeedsOnboarding(false)
      onCompleted?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to finish setup."
      setSaveError(message)
    } finally {
      setIsSaving(false)
    }
  }

  const pickLocalRepo = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select your Hexo repository folder",
      })
      if (typeof selected !== "string") {
        return
      }
      // If fs permission exists, this confirms the selected path is accessible.
      await exists(selected).catch(() => undefined)
      setState((current) => ({ ...current, repo: selected }))
    } catch {
      // user cancelled or plugin unavailable
    }
  }

  if (!mounted) {
    return null
  }

  const showOnboardingSlogan = !showWelcome && needsOnboarding
  const postCount = overview?.post_count
  const draftCount = overview?.draft_count
  const tagCount = overview?.tag_count
  const totalContent = (postCount ?? 0) + (draftCount ?? 0)
  const publishReadyPercent =
    totalContent > 0 ? Math.round(((postCount ?? 0) / totalContent) * 100) : 0
  const syncStatusText = syncing
    ? "Syncing repository..."
    : syncStatus?.has_remote
      ? syncStatus.has_changes
        ? "Changes detected. Ready to sync."
        : syncStatus.has_unpushed_commits
          ? "Unpushed commits detected. Ready to push."
          : "Repository is up to date."
      : "No remote configured."

  return (
    <div
      className={`mx-auto flex w-full flex-1 flex-col gap-6 p-4 md:p-8 ${
        onlyOnboarding ? "max-w-xl items-center justify-center" : "max-w-4xl"
      }`}
    >
      {showWelcome ? (
        <section className="w-full px-1 py-3 md:px-2 md:py-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="bg-background/70 text-foreground">
              <Sparkles className="mr-1 size-3.5" />
              Welcome
            </Badge>
          </div>
          <h1
            className="text-2xl font-semibold tracking-tight md:text-3xl"
            style={{
              fontFamily:
                "var(--font-playfair), ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
            }}
          >
            Welcome to Hero. Start your most focused day.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">
            Break goals into clear steps and move into execution immediately.
          </p>
        </section>
      ) : null}

      {showOnboardingSlogan ? (
        <section className="w-full text-center">
          <div className="mb-1 flex items-center justify-center gap-2">
            <Badge variant="outline" className="bg-background/70 text-foreground">
              <Sparkles className="mr-1 size-3.5" />
              Welcome
            </Badge>
          </div>
          <h1
            className="text-xl font-semibold tracking-tight md:text-2xl"
            style={{
              fontFamily:
                "var(--font-playfair), ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
            }}
          >
            Welcome to Hero. Start your most focused day.
          </h1>
        </section>
      ) : null}

      {needsOnboarding ? (
        <section
          className={`rounded-lg bg-background/60 p-4 md:p-5 ${
            onlyOnboarding ? "w-full max-w-xl min-h-[460px]" : ""
          }`}
        >
          <div className="mb-6">
            <h2 className="text-lg font-semibold">First-time Setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete 3 steps and start in under 30 seconds.
            </p>
          </div>
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className={`rounded-full px-3 py-1.5 text-center text-sm transition-colors ${
                    step === item
                      ? "bg-foreground text-background font-medium"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  Step {item}
                </div>
              ))}
            </div>

            {step === 1 ? (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <UserRound className="text-muted-foreground absolute top-2.5 left-3 size-4" />
                  <Input
                    id="username"
                    className="pl-9"
                    placeholder="Enter your username"
                    value={state.username}
                    onChange={(event) =>
                      setState((current) => ({ ...current, username: event.target.value }))
                    }
                  />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <Label>Hexo Git repository</Label>
                <Tabs
                  value={state.repoType}
                  onValueChange={(value) =>
                    setState((current) => ({
                      ...current,
                      repoType: value as OnboardingState["repoType"],
                    }))
                  }
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="remote">Remote</TabsTrigger>
                    <TabsTrigger value="local">Local</TabsTrigger>
                  </TabsList>
                </Tabs>
                {state.repoType === "local" ? (
                  <ButtonGroup className="w-full">
                    <Input
                      placeholder="/path/to/your/hexo/repo"
                      value={state.repo}
                      onChange={(event) =>
                        setState((current) => ({ ...current, repo: event.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Choose local folder"
                      onClick={pickLocalRepo}
                    >
                      <FolderOpen />
                    </Button>
                  </ButtonGroup>
                ) : (
                  <div className="relative">
                    <GitBranch className="text-muted-foreground absolute top-2.5 left-3 size-4" />
                    <Input
                      className="pl-9"
                      placeholder="git@github.com:you/hexo.git or https://..."
                      value={state.repo}
                      onChange={(event) =>
                        setState((current) => ({ ...current, repo: event.target.value }))
                      }
                    />
                  </div>
                )}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <Label>Theme mode</Label>
                <RadioGroup
                  value={state.theme}
                  onValueChange={(value) =>
                    setState((current) => ({ ...current, theme: normalizeThemePreference(value) }))
                  }
                  className="grid w-full grid-cols-3"
                >
                  <div className="flex items-center justify-center gap-2">
                    <RadioGroupItem id="theme-light" value="light" />
                    <Label htmlFor="theme-light">Light</Label>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <RadioGroupItem id="theme-dark" value="dark" />
                    <Label htmlFor="theme-dark">Dark</Label>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <RadioGroupItem id="theme-system" value="system" />
                    <Label htmlFor="theme-system">System</Label>
                  </div>
                </RadioGroup>
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
              {step < 3 ? (
                <Button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={(step === 1 && !canNextFromStep1) || (step === 2 && !canNextFromStep2)}
                >
                  Next
                </Button>
              ) : (
                <Button onClick={finishOnboarding} disabled={!canFinish || isSaving}>
                  <CheckCircle2 className="mr-1.5 size-4" />
                  {isSaving ? "Saving..." : "Start"}
                </Button>
              )}
            </div>
            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
          </div>
        </section>
      ) : (
        <section className={`space-y-4 ${onlyOnboarding ? "hidden" : ""}`}>
          <div className="rounded-lg bg-background/70 px-1 py-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Rocket className="size-5" />
              Hexo Overview
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome back{state.username ? `, ${state.username}` : ""}. Here is your blog workspace snapshot.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="min-h-44 rounded-xl bg-muted/20 p-6">
              <p className="text-sm text-muted-foreground">Posts</p>
              <p className="mt-4 text-7xl leading-none font-semibold">{postCount ?? "-"}</p>
            </div>
            <div className="min-h-44 rounded-xl bg-muted/20 p-6">
              <p className="text-sm text-muted-foreground">Drafts</p>
              <p className="mt-4 text-7xl leading-none font-semibold">{draftCount ?? "-"}</p>
            </div>
            <div className="min-h-44 rounded-xl bg-muted/20 p-6">
              <p className="text-sm text-muted-foreground">Tags</p>
              <p className="mt-4 text-7xl leading-none font-semibold">{tagCount ?? "-"}</p>
            </div>
          </div>

          <div className="rounded-xl bg-muted/20 p-6">
            <div className="flex items-end justify-between">
              <p className="text-sm text-muted-foreground">Publishing Readiness</p>
              <p className="text-3xl leading-none font-semibold">{publishReadyPercent}%</p>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-foreground transition-all"
                style={{ width: `${publishReadyPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Based on published posts vs drafts.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-muted/20 p-6 text-sm text-muted-foreground">
              <p className="text-foreground font-medium">Workspace</p>
              <p className="mt-3">Path: {(overview?.repo_path ?? state.repo) || "-"}</p>
              <p>Source: {state.repoType === "remote" ? "Cloned from remote" : "Local folder"}</p>
              {state.remoteUrl ? <p>Remote: {state.remoteUrl}</p> : null}
            </div>
            <div className="rounded-xl bg-muted/20 p-6 text-sm text-muted-foreground">
              <p className="text-foreground font-medium">Environment</p>
              <p className="mt-3">Hexo: {overview?.hexo_version ?? "-"}</p>
              <p>Theme mode: {state.theme || "-"}</p>
              <p>Branch: {syncStatus?.branch ?? "-"}</p>
              <div className="mt-4 flex gap-2">
                {syncStatus?.has_remote ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={syncRepo}
                    disabled={
                      syncLoading ||
                      syncing ||
                      (!syncStatus.has_changes && !syncStatus.has_unpushed_commits)
                    }
                  >
                    {syncing ? <Loader2 className="size-4 animate-spin" /> : null}
                    {syncing ? "Syncing" : "Sync"}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshSnapshot}
                  disabled={overviewLoading || syncLoading || syncing}
                >
                  Refresh
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href="/list">Open List</a>
                </Button>
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs">
                {syncing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span>{syncStatusText}</span>
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            {overviewLoading ? <p>Loading repository overview...</p> : null}
            {overviewError ? <p className="text-destructive">{overviewError}</p> : null}
            {syncLoading ? <p>Loading git sync status...</p> : null}
            {syncError ? <p className="text-destructive">{syncError}</p> : null}
          </div>
        </section>
      )}
    </div>
  )
}
