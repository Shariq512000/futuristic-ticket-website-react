// Full 3D preview of a stadium config in a modal, using the same viewer as the public site.
import { useEffect, useRef, useState } from 'react';

export default function Preview3D({ config, onClose }) {
  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    // three.js is only loaded when the preview is opened
    import('../../viewer/StadiumViewer.js').then(({ StadiumViewer }) => {
      if (disposed) return;
      try {
        const viewer = new StadiumViewer(stageRef.current);
        viewerRef.current = viewer;
        viewer.load({
          id: 'preview', title: config.name, short: config.name.toUpperCase().slice(0, 22), stage: 'Preview',
          currency: 'PKR', prices: { default: 1 },
        }, config);
        window.stadiumPreview = viewer;
      } catch (err) {
        setError(err.message);
      }
    });
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKey);
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, [config, onClose]);

  return (
    <div className="preview-modal" role="dialog" aria-modal="true">
      <div className="preview-head">
        <b>3D preview · {config.name}</b>
        <span className="muted small">Drag to orbit · click a stand to fly in · click a seat to see its view</span>
        <div className="row-actions" style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn sm" onClick={() => viewerRef.current?.goOverview()}>Whole stadium</button>
          <button type="button" className="btn sm primary" onClick={onClose}>Close preview</button>
        </div>
      </div>
      {error ? <div className="pad form-error">{error}</div> : <div className="preview-stage" ref={stageRef} />}
    </div>
  );
}
