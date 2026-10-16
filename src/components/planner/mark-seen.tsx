"use client";

import { useEffect, useRef } from "react";

import { markMyTasksSeenAction } from "@/server/actions/portal.actions";

/**
 * Marks tasks given to the signed-in person as seen once they are on the
 * screen (the read receipt management sees). Each task is sent once; tasks
 * given to anyone else are left alone by the server.
 */
export function useMarkTasksSeen(taskIds: readonly string[]) {
  const sent = useRef(new Set<string>());
  const key = taskIds.join(",");
  useEffect(() => {
    const fresh = key.split(",").filter((id) => id && !sent.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) sent.current.add(id);
    void markMyTasksSeenAction(fresh).catch(() => {});
  }, [key]);
}

/** The same, for a page that shows one task given to the person (the Planner's task page). */
export function MarkTaskSeen({ taskId }: { taskId: string }) {
  useMarkTasksSeen([taskId]);
  return null;
}
