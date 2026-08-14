/*
 * Presigned PUT upload, ported from the legacy lib/r2-upload.ts. The browser sends the file
 * straight to R2; the form only ever carries the returned object key.
 *
 * Markup contract (see partials/file-upload.ejs):
 *   <div data-upload data-upload-prefix="receipts">
 *     <input type="file" data-upload-input>
 *     <input type="hidden" name="receiptObjectKey" data-upload-key>
 *     <img data-upload-preview>
 *     <p data-upload-status></p>
 *   </div>
 */
(function () {
  function csrfToken() {
    var field = document.querySelector('input[name="_csrf"]');
    return field ? field.value : '';
  }

  async function upload(root, file) {
    var status = root.querySelector('[data-upload-status]');
    var keyField = root.querySelector('[data-upload-key]');
    var preview = root.querySelector('[data-upload-preview]');
    var prefix = root.getAttribute('data-upload-prefix') || 'receipts';

    function say(message) {
      if (status) status.textContent = message;
    }

    // Shown instantly from the local file, before (and regardless of whether)
    // the upload succeeds — no extra request needed to preview it.
    if (preview) {
      if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
      var objectUrl = URL.createObjectURL(file);
      preview.src = objectUrl;
      preview.dataset.objectUrl = objectUrl;
      preview.hidden = false;
    }

    say('Uploading ' + file.name + '…');

    try {
      var signResponse = await fetch('/uploads/sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          prefix: prefix,
        }),
      });

      if (!signResponse.ok) throw new Error('Could not prepare the upload');
      var signed = await signResponse.json();

      var putResponse = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!putResponse.ok) throw new Error('Upload rejected by storage');

      keyField.value = signed.objectKey;
      say('Attached: ' + file.name);

      // The payment form listens for this to kick off receipt OCR.
      root.dispatchEvent(
        new CustomEvent('upload:done', {
          bubbles: true,
          detail: { objectKey: signed.objectKey },
        }),
      );
    } catch (error) {
      say(error.message + '. You can still save without the attachment.');
    }
  }

  document.addEventListener('change', function (event) {
    var input = event.target.closest('[data-upload-input]');
    if (!input || !input.files || !input.files[0]) return;

    var root = input.closest('[data-upload]');
    if (root) upload(root, input.files[0]);
  });
})();
