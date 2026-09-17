import { useMediaQuery } from './useMediaQuery';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

/**
 * 3-tier responsive breakpoint hook.
 * - phone:   ≤ 1140px  (bottom toolbar injection on ≤987px where Excalidraw shows mobile toolbar,
 *                        upper toolbar Island injection on 988–1140px)
 * - tablet:  1141–1400px
 * - desktop: > 1400px
 *
 * Note: Excalidraw's mobile breakpoint has been patched to 987px (was 599px in
 * @excalidraw/common's getFormFactor; the old 730px MQ_MAX_WIDTH_PORTRAIT is gone).
 * At ≤987px, Excalidraw shows the mobile bottom toolbar (`.mobile-toolbar`).
 * At >987px, Excalidraw shows the top toolbar (`.App-toolbar-container`).
 * Our "phone" tier covers both ranges — the injection target is chosen dynamically
 * via `isExcalidrawMobile` (max-width: 987px) in Viewer.tsx.
 */
export function useBreakpoint(): Breakpoint {
  const isPhone = useMediaQuery('(max-width: 1140px)');
  const isTablet = useMediaQuery('(min-width: 1141px) and (max-width: 1400px)');
  if (isPhone) return 'phone';
  if (isTablet) return 'tablet';
  return 'desktop';
}
