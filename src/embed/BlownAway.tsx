import { useEffect, useRef } from 'react';
import { mountGame, type MountOptions } from './mountGame';

/**
 * React wrapper for Shepherd. Load it lazily so Phaser stays out of the main bundle:
 *
 *   const BlownAway = lazy(() => import('blown-away/embed/BlownAway'));
 *   <div className="fixed inset-0"><BlownAway onFinish={submitRun} onExit={() => navigate(-1)} /></div>
 *
 * Options are read once on mount; change the `key` to remount with new ones.
 */
export default function BlownAway(props: MountOptions & { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const handle = mountGame(ref.current!, {
      ...propsRef.current,
      onFinish: (run) => propsRef.current.onFinish?.(run),
      onExit: propsRef.current.onExit ? () => propsRef.current.onExit?.() : undefined,
    });
    return () => handle.destroy();
  }, []);

  return <div ref={ref} className={props.className} style={{ width: '100%', height: '100%' }} />;
}
