import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('opens gallery webview and logs panel details', async () => {
		const panel = await vscode.commands.executeCommand<{
			title: string;
			visible: boolean;
			htmlHasGalleryState: boolean;
		}>('skynet-harness.test.openGallery');

		assert.ok(panel, 'openGallery returns the created webview panel');
		assert.deepStrictEqual(panel, {
			title: 'Skynet',
			visible: true,
			htmlHasGalleryState: true,
		});

		console.log('[ui-test] opened gallery panel', {
			title: panel.title,
			visible: panel.visible,
			htmlHasGalleryState: panel.htmlHasGalleryState,
		});
	});
});
