"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Command, House, FileText, Pencil } from "lucide-react"

// import { NavUser } from "@/components/nav-user"
import { NavUser } from "./nav-user"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"

// This is sample data
const data = {
    user: {
        name: "shadcn",
        email: "m@example.com",
        avatar: "/avatars/shadcn.jpg",
    },
    navMain: [
        {
            title: "Home",
            url: "/",
            icon: House,
        },
        {
            title: "List",
            url: "/list",
            icon: FileText,
        },
        {
            title: "Editor",
            url: "/editor?new=1",
            icon: Pencil,
        },
    ],
}

export function AppSidebar({ children, ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname()
    const isItemActive = React.useCallback(
        (url: string) => {
            const normalizedUrl = url.split("?")[0] ?? url
            if (url === "/") {
                return pathname === "/"
            }
            return pathname === normalizedUrl || pathname.startsWith(`${normalizedUrl}/`)
        },
        [pathname]
    )

    return (
        <Sidebar
            collapsible="icon"
            className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
            {...props}
        >
            {/* This is the first sidebar */}
            {/* We disable collapsible and adjust width to icon. */}
            {/* This will make the sidebar appear as icons. */}
            <Sidebar
                collapsible="none"
                className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
            >
                <SidebarHeader>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
                                <a href="#">
                                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                        <Command className="size-4" />
                                    </div>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-medium">Acme Inc</span>
                                        <span className="truncate text-xs">Enterprise</span>
                                    </div>
                                </a>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent className="px-1.5 md:px-0">
                            <SidebarMenu className="space-y-1.5 py-1">
                                {data.navMain.map((item) => (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            tooltip={{
                                                children: item.title,
                                                hidden: false,
                                            }}
                                            asChild
                                            isActive={isItemActive(item.url)}
                                            className="px-2.5 md:px-2 data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:shadow-sm"
                                        >
                                            <Link href={item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter>
                    <NavUser user={data.user} />
                </SidebarFooter>
            </Sidebar>

            {children}


        </Sidebar>
    )
}
