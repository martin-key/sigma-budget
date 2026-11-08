import { icon } from './Icon';
import { href } from '../lib/legacy';
export type TextView = 'ready' | 'loading' | 'empty' | 'error' | 'pending';
export function TextState({
  view,
  title,
  retry,
}: {
  view: TextView;
  title: string;
  retry?: () => void;
}) {
  if (view === 'loading')
    return (
      <div className="skel skel-page" data-state="loading" role="status" aria-busy="true">
        <span className="sr-only">Зареждане…</span>
        <div className="skel-row">
          <span className="skel-card" />
          <span className="skel-card" />
          <span className="skel-card" />
        </div>
        <span className="skel-block" />
        <span className="skel-bar skel-w2" />
        <span className="skel-bar skel-w4" />
      </div>
    );
  if (view === 'error')
    return (
      <div className="state state-error" data-state="error" role="alert">
        <span className="state-ic">{icon('alert', { size: 28 })}</span>
        <div className="state-main">
          <p className="state-title">Не успяхме да заредим данните.</p>
          <p className="state-text">Опитай пак.</p>
          <p className="state-act">
            <button
              type="button"
              className="btn btn-primary"
              data-action="retry"
              onClick={(e) => {
                e.stopPropagation();
                retry?.();
              }}
            >
              {icon('refresh', { size: 16 })} Опитай пак
            </button>{' '}
            <a className="btn" href={href('danni')}>
              Откъде са данните
            </a>
          </p>
        </div>
      </div>
    );
  if (view === 'empty')
    return (
      <div className="state state-empty" data-state="empty">
        <span className="state-ic">{icon('search', { size: 28 })}</span>
        <div className="state-main">
          <p className="state-title">Няма какво да покажем тук</p>
          <p className="state-text">Опитай с друга година или друг изглед.</p>
        </div>
      </div>
    );
  return (
    <div className="state state-pending" data-state="pending">
      <span className="state-ic">{icon('dashed', { size: 28 })}</span>
      <div className="state-main">
        <p className="state-kicker">Предстои</p>
        <p className="state-title">{title}</p>
        <p className="state-text">Данните съществуват при издателя, още не са извлечени.</p>
      </div>
    </div>
  );
}
