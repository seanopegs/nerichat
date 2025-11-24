// Cropper Utils
// Requires cropperjs loaded globally

const CropperUtils = {
    modalId: 'cropperModal',

    injectModal: function() {
        if (document.getElementById(this.modalId)) return;

        const html = `
        <div id="${this.modalId}" class="modal hidden" style="z-index: 3000;">
            <div class="modal-content" style="max-width: 500px; width: 95%;">
                <div class="modal-header">
                    <h3>Crop Image</h3>
                    <span class="close-modal-cropper">&times;</span>
                </div>
                <div style="height: 400px; width: 100%; background: #000; overflow: hidden; display:flex; align-items:center; justify-content:center;">
                    <img id="cropperImage" style="max-width: 100%; max-height: 100%; display: block;">
                </div>
                <div class="modal-actions-right" style="margin-top: 20px;">
                    <button id="cancelCropBtn" class="btn btn-secondary">Cancel</button>
                    <button id="confirmCropBtn" class="btn btn-primary">Crop & Use</button>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    cropImage: function(file, aspectRatio = NaN) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                resolve(file); // Not an image, pass through
                return;
            }

            this.injectModal();

            const modal = document.getElementById(this.modalId);
            const image = document.getElementById('cropperImage');
            const confirmBtn = document.getElementById('confirmCropBtn');
            const cancelBtn = document.getElementById('cancelCropBtn');
            const closeBtn = modal.querySelector('.close-modal-cropper');

            let cropper = null;

            const cleanup = () => {
                if (cropper) cropper.destroy();
                modal.classList.add('hidden');
                image.src = '';
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                closeBtn.onclick = null;
            };

            const reader = new FileReader();
            reader.onload = (e) => {
                image.src = e.target.result;
                modal.classList.remove('hidden');

                cropper = new Cropper(image, {
                    aspectRatio: aspectRatio,
                    viewMode: 1,
                    autoCropArea: 0.9,
                    background: false
                });
            };
            reader.readAsDataURL(file);

            confirmBtn.onclick = () => {
                if (!cropper) return;
                cropper.getCroppedCanvas().toBlob((blob) => {
                    if (!blob) {
                        // Fallback or error
                        cleanup();
                        resolve(file);
                        return;
                    }
                    // Create a new File object
                    const newFile = new File([blob], file.name, { type: file.type });
                    cleanup();
                    resolve(newFile);
                }, file.type);
            };

            const cancelAction = () => {
                cleanup();
                // We resolve with original file if cancelled? Or reject?
                // Request says "crop fotonya", implying it's a step.
                // If I cancel crop, maybe I just want to send original?
                // Or maybe cancel upload.
                // Let's Reject to allow cancellation of upload.
                reject('Cropping cancelled');
            };

            cancelBtn.onclick = cancelAction;
            closeBtn.onclick = cancelAction;
        });
    }
};

window.CropperUtils = CropperUtils;
