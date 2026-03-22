"use client"

import { isTauri } from "@tauri-apps/api/core"
import { load } from "@tauri-apps/plugin-store"

export type OnboardingProfile = {
  username: string
  repoType: "remote" | "local"
  repo: string
  remoteUrl?: string
  theme: "light" | "dark" | "system"
}

const STORE_PATH = "hero-settings.json"
const COMPLETED_KEY = "hero.onboarding.completed"
const PROFILE_KEY = "hero.onboarding.profile"

type StoredData = {
  completed: boolean
  profile?: OnboardingProfile
}

export type ThemePreference = "light" | "dark" | "system"

export function normalizeThemePreference(value: string | undefined): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value
  }
  return "system"
}

export async function readOnboardingState(): Promise<StoredData> {
  if (!isTauri()) {
    return { completed: false }
  }

  try {
    const store = await load(STORE_PATH)
    const completed = Boolean(await store.get<boolean>(COMPLETED_KEY))
    const profile = await store.get<OnboardingProfile>(PROFILE_KEY)
    return { completed, profile: profile ?? undefined }
  } catch {
    return { completed: false }
  }
}

export async function saveOnboardingState(profile: OnboardingProfile): Promise<void> {
  if (!isTauri()) {
    return
  }

  const store = await load(STORE_PATH)
  await store.set(COMPLETED_KEY, true)
  await store.set(PROFILE_KEY, profile)
  await store.save()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("hero-theme-updated"))
  }
}

export async function resetOnboardingState(): Promise<void> {
  if (!isTauri()) {
    return
  }

  const store = await load(STORE_PATH)
  await store.delete(COMPLETED_KEY)
  await store.delete(PROFILE_KEY)
  await store.save()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("hero-theme-updated"))
  }
}
