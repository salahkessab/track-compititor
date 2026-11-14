/** Keep actionable errors visible; put transport diagnostics behind a disclosure. */
export function WorkspaceError({ message }: { message: string }) {
  const transportFailure = /unexpected end of json|failed to execute ['"]json|unexpected token.*json|failed to fetch|networkerror/i.test(message);
  if (!transportFailure) return <span>{message}</span>;
  return <div className="space-y-2">
    <p>We couldn’t load the latest workspace update. Try reconnecting.</p>
    <details className="text-sm"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 break-words">{message}</p></details>
  </div>;
}
