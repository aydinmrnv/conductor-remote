import { useMemo } from 'react'
import { useDiff, useWorkspaces } from '../hooks.ts'
import { cn } from '../lib/cn.ts'
import { MergeBanner } from './MergeBanner.tsx'
import { Empty, Spinner } from './ui.tsx'

export function DiffView({ workspaceId }: { workspaceId: string }) {
	const { data: state } = useWorkspaces()
	const ws = state?.workspaces.find(w => w.id === workspaceId)
	return (
		<div className="pb-safe flex flex-1 flex-col overflow-y-auto">
			{ws ? <MergeBanner ws={ws} /> : null}
			<DiffBody workspaceId={workspaceId} />
		</div>
	)
}

function DiffBody({ workspaceId }: { workspaceId: string }) {
	const { data, isLoading, isError, error } = useDiff(workspaceId, true)

	if (isLoading && !data) return <Spinner label="Computing diff…" />
	if (isError) return <Empty>{(error as Error)?.message}</Empty>
	if (!data) return <Empty>No diff.</Empty>
	if (data.files.length === 0)
		return (
			<Empty>
				No changes vs <span className="font-mono">{data.base}</span>.
			</Empty>
		)

	return (
		<>
			<div className="border-b border-border-soft px-3 py-2 text-xs text-muted">
				vs <span className="font-mono text-faint">{data.base}</span> · {data.files.length} file
				{data.files.length === 1 ? '' : 's'}
			</div>
			<ul className="flex flex-col gap-1 px-3 py-3">
				{data.files.map(f => (
					<li key={f.path} className="flex items-center gap-2 font-mono text-[12px]">
						<span className="truncate text-muted">{f.path}</span>
						<span className="ml-auto shrink-0 text-add">+{f.added}</span>
						<span className="shrink-0 text-del">−{f.removed}</span>
					</li>
				))}
			</ul>
			<Patch patch={data.patch} truncated={data.truncated} />
		</>
	)
}

function Patch({ patch, truncated }: { patch: string; truncated: boolean }) {
	const lines = useMemo(() => patch.split('\n'), [patch])
	return (
		<pre className="overflow-x-auto border-t border-border-soft px-3 py-3 font-mono text-[11.5px] leading-[1.5]">
			{lines.map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: patch lines are a static render list
				<div key={i} className={cn('whitespace-pre', lineClass(line))}>
					{line || ' '}
				</div>
			))}
			{truncated ? <div className="mt-2 text-faint">… diff truncated …</div> : null}
		</pre>
	)
}

function lineClass(line: string): string {
	if (line.startsWith('+') && !line.startsWith('+++')) return 'text-add'
	if (line.startsWith('-') && !line.startsWith('---')) return 'text-del'
	if (line.startsWith('@@')) return 'text-accent'
	if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'))
		return 'text-faint'
	return 'text-muted'
}
