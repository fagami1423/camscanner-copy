import { useEffect, useRef, useState } from 'preact/hooks';
import { CameraScreen } from './ui/CameraScreen';
import { CropScreen } from './ui/CropScreen';
import { DocumentView } from './ui/DocumentView';
import { FilterScreen } from './ui/FilterScreen';
import { Library } from './ui/Library';
import { initNav, navigate, popTo } from './ui/navigation';
import { Settings } from './ui/Settings';
import { Toast } from './ui/Toast';

export type Screen =
  | { name: 'library' }
  | { name: 'camera'; docId: string }
  | { name: 'doc'; docId: string }
  | { name: 'crop'; pageId: string }
  | { name: 'filter'; pageId: string }
  | { name: 'settings' };

const LIBRARY: Screen = { name: 'library' };
const sameScreen = (a: Screen, b: Screen) => JSON.stringify(a) === JSON.stringify(b);

export function App() {
  const navRef = useRef(initNav<Screen>(LIBRARY));
  const [screen, setScreen] = useState<Screen>(LIBRARY);

  // One browser history entry per screen; Back/Forward (system or browser) walk the screen stack.
  // Library is the first app entry, so Back from it leaves the app as usual.
  useEffect(() => {
    history.replaceState({ idx: 0 }, '');
    const onPop = (e: PopStateEvent) => {
      const s = popTo(navRef.current, (e.state as { idx?: unknown } | null)?.idx);
      navRef.current = s;
      setScreen(s.stack[s.index]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (target: Screen, opts: { replace?: boolean } = {}) => {
    const { state, op } = navigate(navRef.current, target, sameScreen, opts);
    navRef.current = state;
    if (op.kind === 'go') history.go(op.delta);
    else if (op.kind === 'push') history.pushState({ idx: op.index }, '');
    else if (op.kind === 'replace') history.replaceState({ idx: op.index }, '');
    if (op.kind === 'push' || op.kind === 'replace') setScreen(target);
  };
  const toLibrary = () => go(LIBRARY);
  const toDoc = (docId: string) => go({ name: 'doc', docId });
  const back = () => (navRef.current.index > 0 ? history.back() : undefined);

  let view;
  switch (screen.name) {
    case 'library':
      view = (
        <Library
          onOpen={toDoc}
          onScan={(docId) => go({ name: 'camera', docId })}
          onSettings={() => go({ name: 'settings' })}
        />
      );
      break;
    case 'camera':
      view = (
        <CameraScreen
          key={screen.docId}
          docId={screen.docId}
          // An empty document is deleted when the camera closes, so it has no screen to return to.
          onDone={(empty) => (empty ? toLibrary() : go({ name: 'doc', docId: screen.docId }, { replace: true }))}
          onCancel={(empty) => (empty ? toLibrary() : back())}
        />
      );
      break;
    case 'doc':
      view = (
        <DocumentView
          key={screen.docId}
          docId={screen.docId}
          onBack={toLibrary}
          onAddPages={() => go({ name: 'camera', docId: screen.docId })}
          onOpenPage={(pageId) => go({ name: 'crop', pageId })}
        />
      );
      break;
    case 'crop':
      view = (
        <CropScreen
          key={screen.pageId}
          pageId={screen.pageId}
          onApplied={() => go({ name: 'filter', pageId: screen.pageId }, { replace: true })}
          onCancel={toDoc}
        />
      );
      break;
    case 'filter':
      view = <FilterScreen key={screen.pageId} pageId={screen.pageId} onDone={toDoc} />;
      break;
    case 'settings':
      view = <Settings onBack={toLibrary} />;
      break;
  }

  return (
    <>
      {view}
      <Toast />
    </>
  );
}
