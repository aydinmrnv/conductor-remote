import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { groupModelPickerLabels } from '../../../src/shared.ts'
import { cn } from '../lib/cn.ts'

type ModelPickerTrigger = {
	picking: boolean
	toggle: () => void
}

/**
 * Shared picker chrome for an existing chat and for the new-workspace form.
 * The caller owns model loading because a chat can refresh the live Conductor
 * menu, while a new workspace can only read the relay's stored labels.
 */
export function ModelPicker({
	value,
	models,
	onSelect,
	open,
	onOpenChange,
	isFetching = false,
	isError = false,
	empty = 'No models are cached yet. Open a model picker in a chat first.',
	className,
	beforeOptions,
	renderTrigger
}: {
	value?: string
	models: string[]
	onSelect: (model: string) => void
	open?: boolean
	onOpenChange?: (open: boolean) => void
	isFetching?: boolean
	isError?: boolean
	empty?: string
	className?: string
	/** Controls shown above the model choices, such as an existing chat's agent settings. */
	beforeOptions?: ReactNode
	renderTrigger?: (trigger: ModelPickerTrigger) => ReactNode
}) {
	const [internalOpen, setInternalOpen] = useState(false)
	const picking = open ?? internalOpen
	const setPicking = (next: boolean | ((current: boolean) => boolean)) => {
		const resolved = typeof next === 'function' ? next(picking) : next
		if (open === undefined) setInternalOpen(resolved)
		onOpenChange?.(resolved)
	}
	const groups = groupModelPickerLabels(models)

	return (
		<div className="relative">
			{renderTrigger ? (
				renderTrigger({ picking, toggle: () => setPicking(open => !open) })
			) : (
				<button
					type="button"
					onClick={() => setPicking(open => !open)}
					aria-haspopup="menu"
					aria-expanded={picking}
					className={cn('ctl flex max-w-40 items-center gap-1', value && 'ctl-staged', className)}
				>
					<span className="truncate">{value ?? 'Model'}</span>
					<ChevronDown size={13} className="shrink-0" />
				</button>
			)}
			{picking ? (
				<>
					<button
						type="button"
						aria-label="Close model picker"
						onClick={() => setPicking(false)}
						className="fixed inset-0 z-30 cursor-default"
					/>
					<div className="absolute bottom-full left-0 z-40 mb-2 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-surface-2 py-1 shadow-xl shadow-black/40">
						{beforeOptions}
						{isFetching ? <RefreshCw size={10} className="mx-3 my-1.5 animate-spin text-faint" /> : null}
						{groups.length ? (
							groups.map(group => (
								<fieldset key={group.label} className="m-0 min-w-0 border-0 p-0">
									<legend className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium text-faint">{group.label}</legend>
									{group.models.map(model => (
										<button
											type="button"
											key={model}
											onClick={() => {
												setPicking(false)
												onSelect(model)
											}}
											className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm active:bg-surface"
										>
											<span className="min-w-0 flex-1 truncate">{model}</span>
											<Check size={13} className={cn('shrink-0 text-accent', value !== model && 'invisible')} />
										</button>
									))}
								</fieldset>
							))
						) : (
							<div className="px-3 py-2 text-sm text-muted">
								{isFetching ? 'Reading Conductor’s model list…' : empty}
							</div>
						)}
						{isError ? (
							<div className="px-3 py-1.5 text-[11px] text-del">
								{models.length ? 'Couldn’t refresh. Showing saved models.' : 'Couldn’t read the model list.'}
							</div>
						) : null}
					</div>
				</>
			) : null}
		</div>
	)
}
