"use client";

export function StudioIcon({ name }: { name: string }) {
  return (
    <img
      className="studio-icon"
      src={`/studio-icons/${name}.svg`}
      width="20"
      height="20"
      alt=""
      aria-hidden="true"
    />
  );
}

const tools = [
  [
    "recipe-designs",
    "layout",
    "Recipe Designs",
    "Turn a reference photo and exact ingredients into a finished recipe graphic.",
  ],
  [
    "image-to-image",
    "image",
    "Image to Image",
    "Adjust your food photo with precise instructions and quick edits.",
  ],
  [
    "two-in-one",
    "images",
    "2 in one image",
    "Bring two reference images into one composition.",
  ],
  [
    "recipe-intelligence",
    "article",
    "Recipe Intelligence",
    "Discover recipes, prepare articles and manage WordPress publishing.",
  ],
  [
    "home-decor",
    "armchair",
    "Home & Decor",
    "Create an article and images from a selected reference.",
  ],
  [
    "horses",
    "horse",
    "Horses",
    "Explore 36 scene categories, reference images and camera settings.",
  ],
] as const;

export function StudioOverview({
  onNavigate,
}: {
  onNavigate: (id: string) => void;
}) {
  return (
    <section className="studio-overview" aria-label="Studio overview">
      <div className="overview-heading">
        <div>
          <p className="studio-eyebrow">YOUR WORKSPACE</p>
          <h1>Overview</h1>
          <p>Everything you create, in one studio.</p>
        </div>
        <button
          className="ui-primary overview-create"
          onClick={() => onNavigate("recipe-designs")}
        >
          New recipe design
        </button>
      </div>
      <div className="overview-tools">
        {tools.map(([id, icon, title, description]) => (
          <a
            key={id}
            className="overview-tool"
            href={`/?tab=${id}`}
            onClick={(e) => {
              if (
                e.button !== 0 ||
                e.metaKey ||
                e.ctrlKey ||
                e.shiftKey ||
                e.altKey
              )
                return;
              e.preventDefault();
              onNavigate(id);
            }}
          >
            <span className="overview-tool-icon">
              <StudioIcon name={icon} />
            </span>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="overview-open">
              Open workspace <StudioIcon name="arrow-up-right" />
            </span>
          </a>
        ))}
      </div>
      <div className="overview-bottom">
        <section>
          <StudioIcon name="clock" />
          <h2>Continue your work</h2>
          <p>
            Your existing designs and articles stay in their workspaces. Open
            Design History or My articles to pick up where you left off.
          </p>
          <button
            className="ui-secondary"
            onClick={() => onNavigate("recipe-designs")}
          >
            Open Recipe Designs
          </button>
          <button
            className="ui-secondary"
            onClick={() => onNavigate("recipe-intelligence")}
          >
            Open Recipe Intelligence
          </button>
        </section>
        <section>
          <StudioIcon name="gear" />
          <h2>Workspace settings</h2>
          <p>
            Storage usage, connected websites and publishing settings remain
            available in Recipe Intelligence.
          </p>
          <button
            className="ui-secondary"
            onClick={() => {
              onNavigate("recipe-intelligence");
              const url = new URL(window.location.href);
              url.searchParams.set("view", "settings");
              window.history.pushState(null, "", url);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            Manage settings &amp; storage
          </button>
        </section>
      </div>
    </section>
  );
}
