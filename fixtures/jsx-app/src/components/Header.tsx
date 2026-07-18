import CartButton from "#/components/CartButton";
import { UserMenu } from "#/components/UserMenu";

// A component defined and rendered in the same file (regression check 2).
function Badge() {
  return <span className="badge">•</span>;
}

// export default, used ONLY by being rendered in a route (regression check 3).
export default function Header() {
  return (
    <header>
      <Badge />
      <CartButton />
      <UserMenu />
    </header>
  );
}
