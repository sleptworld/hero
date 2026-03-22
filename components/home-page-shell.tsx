"use client"

import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { HomeOnboarding } from "@/components/home-onboarding"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { readOnboardingState } from "@/lib/onboarding-storage"

export function HomePageShell() {
  const [mounted, setMounted] = React.useState(false)
  const [needsOnboarding, setNeedsOnboarding] = React.useState(false)

  React.useEffect(() => {
    let active = true
    setMounted(true)
    readOnboardingState().then((data) => {
      if (!active) {
        return
      }
      setNeedsOnboarding(!data.completed)
    })
    return () => {
      active = false
    }
  }, [])

  if (!mounted) {
    return null
  }

  if (needsOnboarding) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-background">
        <HomeOnboarding showWelcome={false} onlyOnboarding onCompleted={() => setNeedsOnboarding(false)} />
      </main>
    )
  }

  return (
    <SidebarProvider
      open={false}
      onOpenChange={() => {}}
      style={
        {
          "--sidebar-width": "350px",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset>
        <HomeOnboarding />
      </SidebarInset>
    </SidebarProvider>
  )
}
