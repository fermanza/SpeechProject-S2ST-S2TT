const API_URL = `${process.env.REACT_APP_BACKEND_URL}/translate`;

export const uploadAudio = async (audioBlob) => {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const response = await fetch(API_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('Error:', errorData);
    throw new Error('Network response was not ok');
  }

  return await response.json();
};