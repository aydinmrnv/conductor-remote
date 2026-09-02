export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
	const input = document.createElement('textarea')
	input.value = text
	input.setAttribute('readonly', '')
	input.style.cssText = 'position:fixed;opacity:0'
	document.body.append(input)
	input.select()
	const copied = document.execCommand('copy')
	input.remove()
	if (!copied) throw new Error('Clipboard unavailable')
}
