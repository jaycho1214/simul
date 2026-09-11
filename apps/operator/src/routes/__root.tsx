import { createRootRoute, Outlet } from "@tanstack/react-router";
import BaseLayout from "@/layouts/base-layout";

// No router devtools, even in development: the window has one route and no
// loaders, and the devtools' floating button sat exactly on the rail footer's
// language toggle in `pnpm start`, hiding it from anyone trying it out.
function Root() {
  return (
    <BaseLayout>
      <Outlet />
    </BaseLayout>
  );
}

export const Route = createRootRoute({
  component: Root,
});
