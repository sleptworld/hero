"use client"

import * as React from "react"
import { useTheme } from "next-themes"

import { normalizeThemePreference, readOnboardingState } from "@/lib/onboarding-storage"

export function ThemeSync() {
  const { setTheme } = useTheme()

  React.useEffect(() => {
    let active = true

    const applyTheme = async () => {
      const state = await readOnboardingState()
      if (!active) {
        return
      }
      const theme = normalizeThemePreference(state.profile?.theme)
      setTheme(theme)
    }

    const onThemeUpdated = () => {
      void applyTheme()
    }
    window.addEventListener("hero-theme-updated", onThemeUpdated)

    void applyTheme()

    return () => {
      active = false
      window.removeEventListener("hero-theme-updated", onThemeUpdated)
    }
  }, [setTheme])

  return null
}
