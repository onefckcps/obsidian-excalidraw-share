# Obsidian Plugin: Collab Follow Mode Bugs

## Bug 1: Invisible Collaborator Entries in Excalidraw Sidebar (Mobile)

### Symptoms
- On Android (Obsidian mobile), the collaborator entries appear in the right-side vertical toolbar (where custom pens, scripts, etc. are)
- The entries are **invisible** — no visible text, icons, or background until clicked
- Only after clicking (activating follow mode) does the eye icon become visible
- The collaborator UI overlaps/covers other toolbar entries
- Affects both light and dark mode

### Root Cause Analysis

When we call `api.updateScene({ collaborators: new Map(this.collaboratorMap) })` in [`syncCollaboratorsToExcalidraw()`](obsidian-plugin/collabManager.ts:1188), Excalidraw renders its **built-in `UserList` component** with collaborator avatars. On mobile Obsidian, the Excalidraw plugin (zsviczian's) places these in the right-side vertical toolbar.

The problem is that the Excalidraw `UserList` component is designed for the web Excalidraw UI, and its CSS styling conflicts with or is not properly inherited within the Obsidian Excalidraw plugin's mobile toolbar context. Specifically:

1. **Color/visibility**: The built-in Excalidraw collaborator avatars use CSS variables and styles that may not be defined or may resolve to transparent/invisible values within Obsidian's theme context
2. **Overlapping**: The `UserList` component is absolutely positioned and doesn't account for the Obsidian Excalidraw plugin's mobile toolbar layout
3. **No custom styling**: Our plugin injects no CSS to fix the collaborator avatar rendering in Obsidian's context

### Fix Strategy

**Option A (Recommended): Inject CSS overrides for Excalidraw's collaborator UI**

Add CSS rules in [`injectGlobalStyles()`](obsidian-plugin/styles.ts:203) to:
- Ensure collaborator avatars/badges are visible in both light and dark Obsidian themes
- Fix z-index and positioning to prevent overlap with the mobile toolbar
- Style the follow/eye icon to be visible before activation

**Option B: Build a custom collaborator panel in the ExcaliShare toolbar**

Instead of relying on Excalidraw's built-in `UserList`, build our own collaborator list in the ExcaliShare floating toolbar (similar to the frontend's `CollabPopover`). This gives us full control over styling and behavior.

**Recommendation**: Option B is more robust and gives us full control. The Excalidraw built-in `UserList` was never designed for our external collab system. Building our own panel in the toolbar also lets us properly wire up follow mode (see Bug 2).

---

## Bug 2: Follow Mode Not Working in Obsidian (Viewport Not Updating)

### Symptoms
- User activates follow mode by clicking on a collaborator in the Excalidraw sidebar
- The eye icon shows (follow mode appears activated)
- But the viewport does NOT move when the followed browser client moves
- Follow mode works correctly between browser clients
- Only broken in the Obsidian → browser direction

### Root Cause Analysis

This is a **fundamental disconnect** between Excalidraw's built-in follow mode and our custom WebSocket-based collaboration:

1. **Excalidraw's built-in follow mode**: When the user clicks a collaborator avatar, Excalidraw internally sets `appState.userToFollow = { socketId, username }`. Excalidraw's internal follow logic then tries to scroll the viewport to match the followed user's viewport. But this relies on Excalidraw's own internal collab mechanism (which we don't use).

2. **Our follow mode**: We have [`CollabManager.startFollowing(userId)`](obsidian-plugin/collabManager.ts:156) which sets `this.followingUserId` and then the [`handlePointerUpdate()`](obsidian-plugin/collabManager.ts:532) method updates `followTarget` when pointer_update messages arrive from the followed user. The [`startFollowLerpLoop()`](obsidian-plugin/collabManager.ts:1036) then smoothly interpolates the viewport.

3. **The disconnect**: When the user clicks a collaborator avatar in Excalidraw's UI, Excalidraw sets `appState.userToFollow` internally, but **our `CollabManager.startFollowing()` is never called**. Our code has no way to detect that the user activated follow mode through Excalidraw's built-in UI.

4. **Even if we detected it**: Excalidraw's `userToFollow` uses `socketId` as the identifier, but our collaborator Map uses our own `userId` (from the WebSocket server). These are different identifiers, so even if Excalidraw's internal follow mode tried to work, it wouldn't find the right viewport data.

### Why It Works Between Browser Clients

In the browser frontend, we **don't use Excalidraw's built-in follow mode at all**. Instead:
- We intercept clicks on `.Avatar` elements via a DOM event listener in [`Viewer.tsx`](frontend/src/Viewer.tsx:190)
- We call our own `collab.startFollowing(userId)` / `collab.stopFollowing()`
- Our `useCollab` hook handles the viewport lerp interpolation
- The Excalidraw built-in follow mode is never triggered

### Fix Strategy

**Two-part fix needed:**

#### Part 1: Detect Excalidraw's `userToFollow` changes and bridge to our follow system

In the [`onChange`](obsidian-plugin/collabManager.ts:662) callback, we already receive `appState` but ignore it. We need to:
1. Check `appState.userToFollow` for changes
2. Map the `socketId` from Excalidraw's `userToFollow` to our `userId` (the key in our collaborator Map)
3. Call `this.startFollowing(userId)` when follow is activated
4. Call `this.stopFollowing()` when follow is deactivated

**Problem**: The `socketId` in `appState.userToFollow` is the key we used in the collaborator Map (which is our `userId`). So the mapping should be direct — we just need to read `appState.userToFollow.socketId` and use it as the `userId` for our follow system.

#### Part 2: Build custom collaborator panel (preferred, combines with Bug 1 fix)

Instead of relying on Excalidraw's built-in follow UI (which has visibility issues on mobile), build a custom collaborator panel in the ExcaliShare toolbar that:
- Shows all collaborators with colored dots and names
- Has a follow/unfollow button (eye icon) for each collaborator
- Directly calls `CollabManager.startFollowing(userId)` / `stopFollowing()`
- Bypasses Excalidraw's built-in follow mechanism entirely

This is the same approach used by the frontend's [`CollabPopover`](frontend/src/CollabPopover.tsx).

---

## Implementation Plan

### Approach: Dual fix — Bridge Excalidraw's follow + Custom collaborator panel

We'll implement both approaches for maximum compatibility:

### Step 1: Bridge Excalidraw's `appState.userToFollow` to our follow system

**File: `obsidian-plugin/collabManager.ts`**

In the `onChange` callback, detect `userToFollow` changes:

```typescript
// In startEventDrivenDetection():
this.onChangeUnsubscribe = api.onChange!(
  (elements, appState, _files) => {
    this.handleLocalSceneChange(elements);
    this.handleAppStateChange(appState);  // NEW
  }
);
```

New method:
```typescript
private lastUserToFollow: string | null = null;

private handleAppStateChange(appState: Record<string, unknown>): void {
  // Detect Excalidraw's built-in follow mode activation
  const userToFollow = appState.userToFollow as { socketId?: string } | null | undefined;
  const followId = userToFollow?.socketId ?? null;
  
  if (followId !== this.lastUserToFollow) {
    this.lastUserToFollow = followId;
    if (followId && followId !== this.followingUserId) {
      // Excalidraw's UI activated follow — bridge to our system
      this.startFollowing(followId);
    } else if (!followId && this.followingUserId) {
      // Excalidraw's UI deactivated follow
      this.stopFollowing();
    }
  }
}
```

### Step 2: Add collaborator panel to ExcaliShare toolbar

**File: `obsidian-plugin/toolbar.ts`**

Add a collaborator section to the expanded toolbar panel when collab is active and native-joined:
- List each collaborator with colored dot, name, and follow/eye button
- Follow button calls a new callback `onStartFollowing(userId)` / `onStopFollowing()`
- Show "Following X" indicator when following someone

**File: `obsidian-plugin/main.ts`**

Wire up the new toolbar callbacks to `CollabManager.startFollowing()` / `stopFollowing()`.

### Step 3: Fix CSS for Excalidraw's built-in collaborator UI

**File: `obsidian-plugin/styles.ts`**

Add CSS overrides in `injectGlobalStyles()` to:
- Make Excalidraw's built-in `UserList` / `.Avatar` elements visible in Obsidian
- Fix z-index issues on mobile
- Ensure the eye/follow icon is visible before activation

This serves as a fallback for desktop users who might interact with Excalidraw's built-in UI.

### Step 4: Add polling-based follow detection as fallback

For older Excalidraw versions without `onChange`, add a check in the polling loop to read `appState.userToFollow` and bridge it to our follow system.

---

## Files to Modify

| File | Changes |
|------|---------|
| `obsidian-plugin/collabManager.ts` | Add `handleAppStateChange()`, bridge `userToFollow` to our follow system, add polling fallback |
| `obsidian-plugin/toolbar.ts` | Add collaborator panel with follow buttons to expanded toolbar |
| `obsidian-plugin/styles.ts` | Add CSS overrides for Excalidraw's built-in collaborator UI visibility |
| `obsidian-plugin/main.ts` | Wire up new toolbar follow callbacks to CollabManager |
| `obsidian-plugin/collabTypes.ts` | Add toolbar callback types if needed |

## Testing Checklist

- [ ] Start collab from Obsidian, join from browser
- [ ] Verify collaborator entries are visible in Excalidraw sidebar (both themes)
- [ ] Verify custom collaborator panel in ExcaliShare toolbar shows all participants
- [ ] Click follow in custom panel → viewport follows browser client
- [ ] Click follow in Excalidraw's built-in UI → viewport follows browser client (bridge)
- [ ] Stop following → viewport stops moving
- [ ] Followed user leaves → follow mode stops automatically
- [ ] Test on Android (mobile) and desktop
