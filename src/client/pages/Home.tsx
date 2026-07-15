import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { NANOID_LENGTH } from '@shared/constants';

export default function Home() {
  const navigate = useNavigate();

  function handleCreateRoom() {
    const roomId = nanoid(NANOID_LENGTH);
    navigate(`/room/${roomId}`);
  }

  return (
    <div className="sr-home">
      <h1>Sprint Room</h1>
      <p>Turn messy ideas into sprint-ready plans — humans + Sprint AI in one shared room.</p>
      <button className="sr-primary" onClick={handleCreateRoom}>
        Create Room
      </button>
    </div>
  );
}
