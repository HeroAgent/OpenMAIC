/**
 * Cloud Sync Hook for OpenMAIC
 *
 * Syncs course data between local IndexedDB and Hero backend.
 * All sync operations are silent (non-blocking, fire-and-forget).
 * Local data always takes priority for user experience.
 */

import { db } from '@/lib/utils/database';
import { loadChatSessions, saveChatSessions } from '@/lib/utils/chat-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CloudSync');

// Determine Hero API base URL
function getHeroApiBase(): string {
  if (typeof window === 'undefined') return '';
  // OpenMAIC runs under /classroom path proxied by Hero server
  // API calls go to /api/classroom/courses (Hero server handles them)
  return '';
}

// Get auth token from hero_token cookie
function getHeroToken(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(/hero_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

interface CloudCourseListItem {
  stageId: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
}

interface CloudCourseDetail {
  stageId: string;
  name: string;
  description?: string;
  scenes: unknown[];
  chats: unknown[];
  outlines: unknown | null;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Save a course to cloud (fire-and-forget)
 */
export async function saveToCloud(stageId: string): Promise<void> {
  const token = getHeroToken();
  if (!token) {
    log.info('[CloudSync] No hero_token, skipping cloud save');
    return;
  }

  try {
    // Load stage data from IndexedDB
    const stage = await db.stages.get(stageId);
    if (!stage) {
      log.warn('[CloudSync] Stage not found in IndexedDB:', stageId);
      return;
    }

    const scenes = await db.scenes.where('stageId').equals(stageId).sortBy('order');
    const chats = await loadChatSessions(stageId);
    const outlinesRecord = await db.stageOutlines.get(stageId);

    // Strip binary data from scenes (don't upload blobs)
    const sanitizedScenes = scenes.map((scene) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = { ...scene } as any;
      // Remove any blob/File fields if present
      delete s.audioBlob;
      delete s.imageBlob;
      return s;
    });

    // Strip binary data from chats
    const sanitizedChats = chats.map((chat) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = { ...chat } as any;
      delete c.audioBlob;
      return c;
    });

    const payload = {
      stageId,
      name: stage.name,
      description: stage.description,
      scenes: sanitizedScenes,
      chats: sanitizedChats,
      outlines: outlinesRecord?.outlines ?? null,
      updatedAt: stage.updatedAt,
    };

    const resp = await fetch(`${getHeroApiBase()}/api/classroom/courses/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      log.warn('[CloudSync] Sync failed:', resp.status, await resp.text());
    } else {
      log.info('[CloudSync] Synced to cloud:', stageId);
    }
  } catch (e) {
    // Silent failure — cloud sync never blocks local usage
    log.warn('[CloudSync] saveToCloud error (silent):', e);
  }
}

/**
 * Load courses from cloud and merge into IndexedDB.
 * Merge strategy: newer updatedAt wins; ties go to local.
 */
export async function loadFromCloud(): Promise<void> {
  const token = getHeroToken();
  if (!token) {
    log.info('[CloudSync] No hero_token, skipping cloud load');
    return;
  }

  try {
    const resp = await fetch(`${getHeroApiBase()}/api/classroom/courses`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      log.warn('[CloudSync] Failed to fetch cloud courses:', resp.status);
      return;
    }

    const data = await resp.json() as { courses: CloudCourseListItem[] };
    const cloudCourses = data.courses || [];

    if (cloudCourses.length === 0) {
      log.info('[CloudSync] No cloud courses found');
      return;
    }

    // Get local stages for comparison
    const localStages = await db.stages.toArray();
    const localMap = new Map(localStages.map((s) => [s.id, s]));

    for (const cloudCourse of cloudCourses) {
      const local = localMap.get(cloudCourse.stageId);

      if (!local) {
        // Cloud has course that local doesn't — download and save
        log.info('[CloudSync] Downloading cloud-only course:', cloudCourse.stageId);
        await downloadCourseFromCloud(cloudCourse.stageId, token);
      } else if (cloudCourse.updatedAt > local.updatedAt) {
        // Cloud is newer — update local
        log.info('[CloudSync] Cloud newer, updating local:', cloudCourse.stageId);
        await downloadCourseFromCloud(cloudCourse.stageId, token);
      } else {
        // Local is same or newer — no action needed
        log.info('[CloudSync] Local is current:', cloudCourse.stageId);
      }
    }

    log.info('[CloudSync] loadFromCloud complete, processed:', cloudCourses.length);
  } catch (e) {
    log.warn('[CloudSync] loadFromCloud error (silent):', e);
  }
}

/**
 * Download a single course from cloud and write to IndexedDB
 */
async function downloadCourseFromCloud(stageId: string, token: string): Promise<void> {
  try {
    const resp = await fetch(`${getHeroApiBase()}/api/classroom/courses/${stageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      log.warn('[CloudSync] Failed to download course:', stageId, resp.status);
      return;
    }

    const detail = await resp.json() as CloudCourseDetail;
    const now = Date.now();

    // Write stage to IndexedDB
    await db.stages.put({
      id: detail.stageId,
      name: detail.name,
      description: detail.description,
      createdAt: detail.createdAt || now,
      updatedAt: detail.updatedAt || now,
    });

    // Write scenes
    if (detail.scenes && detail.scenes.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scenes = detail.scenes as any[];
      await db.scenes.where('stageId').equals(stageId).delete();
      await db.scenes.bulkPut(
        scenes.map((scene, index) => ({
          ...scene,
          stageId,
          order: scene.order ?? index,
          createdAt: scene.createdAt || now,
          updatedAt: scene.updatedAt || now,
        })),
      );
    }

    // Write chat sessions
    if (detail.chats && detail.chats.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveChatSessions(stageId, detail.chats as any[]);
    }

    // Write outlines if present
    if (detail.outlines) {
      await db.stageOutlines.put({
        stageId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outlines: detail.outlines as any,
        createdAt: detail.createdAt || now,
        updatedAt: detail.updatedAt || now,
      });
    }

    log.info('[CloudSync] Downloaded course to local:', stageId);
  } catch (e) {
    log.warn('[CloudSync] downloadCourseFromCloud error:', stageId, e);
  }
}

/**
 * Delete a course from cloud (fire-and-forget)
 */
export async function deleteFromCloud(stageId: string): Promise<void> {
  const token = getHeroToken();
  if (!token) return;

  try {
    const resp = await fetch(`${getHeroApiBase()}/api/classroom/courses/${stageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok && resp.status !== 404) {
      log.warn('[CloudSync] Delete from cloud failed:', resp.status);
    } else {
      log.info('[CloudSync] Deleted from cloud:', stageId);
    }
  } catch (e) {
    log.warn('[CloudSync] deleteFromCloud error (silent):', e);
  }
}
