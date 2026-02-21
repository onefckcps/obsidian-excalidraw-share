import { App, loadPdfJs, TFile } from 'obsidian';

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  let len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const pdfToPng = async (
  app: App,
  file: TFile,
  pageNum: number = 1
): Promise<string> => {
  try {
    await loadPdfJs();
    const pdfjsLib = (window as any).pdfjsLib;
    
    if (!pdfjsLib) {
      throw new Error('PDF.js not loaded');
    }

    const url = app.vault.getResourcePath(file);
    const pdfDoc = await pdfjsLib.getDocument(url).promise;
    const page = await pdfDoc.getPage(pageNum);
    
    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.height = Math.round(viewport.height);
    canvas.width = Math.round(viewport.width);
    
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    return new Promise<string>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (blob) {
          const base64 = await blobToBase64(blob);
          resolve(base64);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      }, 'image/png');
    });
  } catch (e) {
    console.error('Excalidraw Share: PDF conversion failed', e);
    throw e;
  }
};
