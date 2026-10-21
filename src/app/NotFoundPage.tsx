import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'

export function NotFoundPage() {
  return <EmptyState title="Page not found" description="This page doesn't exist." action={<Link to="/" className="text-[13px] underline underline-offset-4">Back to overview</Link>} />
}
