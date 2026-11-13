import { METHODOLOGY_VERSION } from "@/lib/scoring/individual";
import Link from "next/link";

export function RateFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <span>Absolute scoring — each person is assessed on their own public evidence only. Adding or removing anyone never moves another score.</span>
        <Link href="/method" className="mono">
          methodology {METHODOLOGY_VERSION}
        </Link>
      </div>
    </footer>
  );
}
