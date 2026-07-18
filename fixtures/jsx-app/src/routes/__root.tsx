import { createRootRoute, Outlet } from "@tanstack/react-router";
import Header from "#/components/Header";

function RootLayout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
