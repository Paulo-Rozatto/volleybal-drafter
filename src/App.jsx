import React, { useState, useEffect } from 'react';
import PlayerList from './PlayerList';

const INITIAL_ROSTER = [
  { id: '1', name: 'Gabi', score: 4, gender: 'F', height: 'short' },
  { id: '2', name: 'Davi', score: 4, gender: 'M', height: 'tall' },
  { id: '3', name: 'Wellington', score: 5, gender: 'M', height: 'tall' },
  { id: '4', name: 'Iuri', score: 3, gender: 'M', height: 'short' },
  { id: '5', name: 'Corzino', score: 3, gender: 'M', height: 'short' },
  { id: '6', name: 'Paulo', score: 5, gender: 'M', height: 'tall' },
  { id: '7', name: 'Vinicius', score: 5, gender: 'M', height: 'tall' },
  { id: '8', name: 'Estêvão', score: 5, gender: 'M', height: 'short' },
  { id: '9', name: 'Ian', score: 3, gender: 'M', height: 'short' },
  { id: '10', name: 'BH', score: 4, gender: 'M', height: 'Tall' },
  { id: '11', name: 'Churuska', score: 4, gender: 'M', height: 'short' },
  { id: '12', name: 'Ana', score: 2, gender: 'F', height: 'short' },
  { id: '14', name: 'Luiza', score: 3, gender: 'F', height: 'short' },
  { id: '15', name: 'Gostavu', score: 5, gender: 'M', height: 'tall' },
  { id: '16', name: 'Arthur', score: 3, gender: 'M', height: 'tall' },
  { id: '17', name: 'Rodrigo Esteves', score: 2, gender: 'M', height: 'tall' },
  { id: '18', name: 'Euler', score: 4, gender: 'M', height: 'tall' },
  { id: '19', name: 'André', score: 4, gender: 'M', height: 'tall' },
  { id: '20', name: 'Geo', score: 2, gender: 'M', height: 'Tall' }
];

export default function App() {
  // --- Estados Principais ---
  const [currentView, setCurrentView] = useState('draft'); // draft, players, preview, history
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  const [players, setPlayers] = useState(() => {
    const saved = localStorage.getItem('volleyPlayers');
    return saved ? JSON.parse(saved) : INITIAL_ROSTER;
  });

  const [draftHistory, setDraftHistory] = useState(() => {
    const saved = localStorage.getItem('volleyDrafts');
    return saved ? JSON.parse(saved) : [];
  });

  // --- Estados do Sorteio Rápido ---
  const [pastedText, setPastedText] = useState('1- Lucas, 2- Camila, Mariana confirmed, Gabriel...');
  const [sessionPlayers, setSessionPlayers] = useState([]);
  const [teamSize, setTeamSize] = useState(6);
  const [balanceGender, setBalanceGender] = useState(true);
  const [balanceHeight, setBalanceHeight] = useState(true);

  // --- Estados da Prévia e Navegação de Histórico ---
  const [draftPreview, setDraftPreview] = useState(null);
  const [currentDraftIndex, setCurrentDraftIndex] = useState(0);

  // --- Adicionar Jogador Rápido ---
  const [newPlayerName, setNewPlayerName] = useState('');

  // Persistência
  useEffect(() => {
    localStorage.setItem('volleyPlayers', JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    localStorage.setItem('volleyDrafts', JSON.stringify(draftHistory));
  }, [draftHistory]);

  // --- Leitura do Texto / Match ---
  const handleIdentifyPlayers = () => {
    if (!pastedText.trim()) return;

    const normalize = (str) =>
      str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "");

    const cleanText = normalize(pastedText);

    // Encontra os jogadores cadastrados na lista
    const matched = players.filter(p => {
      const cleanName = normalize(p.name);
      return cleanName.length >= 2 && cleanText.includes(cleanName);
    });

    setSessionPlayers(matched);
  };

  // --- Atualização In-Place nos Cards ---
  const handleUpdateSessionPlayer = (id, field, value) => {
    // Atualiza na sessão atual
    setSessionPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    
    // Sincroniza a alteração no cadastro geral
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleUpdatePlayer = (id, field, value) => {
    setPlayers((prevPlayers) =>
      prevPlayers.map((player) =>
        player.id === id ? { ...player, [field]: value } : player
      )
    );
  };

  const handleRemoveFromSession = (id) => {
    setSessionPlayers(sessionPlayers.filter(p => p.id !== id));
  };

  const handleAddQuickPlayer = (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;

    const newP = {
      id: crypto.randomUUID(),
      name: newPlayerName.trim(),
      score: 3,
      gender: 'F',
      height: 'short'
    };

    setPlayers([...players, newP]);
    setSessionPlayers([...sessionPlayers, newP]);
    setNewPlayerName('');
  };

  // --- Algoritmo de Sorteio Monte Carlo ---
  const runMonteCarloDraft = () => {
    const numTeams = Math.floor(sessionPlayers.length / teamSize);
    if (numTeams < 2) {
      alert(`Selecione pelo menos ${teamSize * 2} jogadores para formar dois times de ${teamSize}!`);
      return;
    }

    const sortedPool = [...sessionPlayers].sort((a, b) => b.score - a.score);
    const playersToDraft = sortedPool.slice(0, numTeams * teamSize);
    const bench = sortedPool.slice(numTeams * teamSize);

    const calcPenalty = (teams) => {
      const variance = (arr) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
      };

      const scores = teams.map(t => t.reduce((sum, p) => sum + p.score, 0));
      let penalty = variance(scores) * 4;

      if (balanceGender) {
        const females = teams.map(t => t.filter(p => p.gender === 'F').length);
        penalty += variance(females) * 3;
      }

      if (balanceHeight) {
        const talls = teams.map(t => t.filter(p => p.height === 'tall').length);
        penalty += variance(talls) * 3;
      }

      return penalty;
    };

    let bestTeams = null;
    let minPenalty = Infinity;

    for (let i = 0; i < 10000; i++) {
      const shuffled = [...playersToDraft].sort(() => Math.random() - 0.5);
      const candidateTeams = Array.from({ length: numTeams }, (_, idx) =>
        shuffled.slice(idx * teamSize, (idx + 1) * teamSize)
      );

      const penalty = calcPenalty(candidateTeams);
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestTeams = candidateTeams;
        if (minPenalty === 0) break;
      }
    }

    const result = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleString('pt-BR'),
      teams: bestTeams,
      format: `${teamSize}x${teamSize}`,
      bench
    };

    setDraftPreview(result);
    setCurrentView('preview');
  };

  const handleConfirmDraft = () => {
    if (!draftPreview) return;
    setDraftHistory([draftPreview, ...draftHistory]);
    setCurrentDraftIndex(0);
    setDraftPreview(null);
    setCurrentView('history');
  };

  // --- Renderização da Interface ---

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-800">
      <div className="max-w-3xl mx-auto min-h-screen flex flex-col bg-white shadow-lg relative">
        
        {/* Cabeçalho Fixo com Menu Hamburger */}
        <header className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
          <h1 
            onClick={() => setCurrentView('draft')} 
            className="text-2xl font-black tracking-wide cursor-pointer flex items-center gap-2"
          >
            🏐 Cortada
          </h1>
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 text-2xl focus:outline-none"
          >
            ☰
          </button>
        </header>

        {/* Menu Lateral Dropdown */}
        {isMenuOpen && (
          <div className="bg-blue-700 text-white flex flex-col p-2 space-y-1 shadow-inner">
            <button 
              onClick={() => { setCurrentView('draft'); setIsMenuOpen(false); }}
              className={`p-3 text-left font-semibold rounded-lg ${currentView === 'draft' ? 'bg-blue-800' : 'hover:bg-blue-600'}`}
            >
              ⚡ Sorteio Rápido
            </button>
            <button 
              onClick={() => { setCurrentView('players'); setIsMenuOpen(false); }}
              className={`p-3 text-left font-semibold rounded-lg ${currentView === 'players' ? 'bg-blue-800' : 'hover:bg-blue-600'}`}
            >
              👥 Elenco Completo ({players.length})
            </button>
            <button 
              onClick={() => { 
                if(draftHistory.length === 0) return alert('Nenhum sorteio salvo!');
                setCurrentDraftIndex(0);
                setCurrentView('history'); 
                setIsMenuOpen(false); 
              }}
              className={`p-3 text-left font-semibold rounded-lg ${currentView === 'history' ? 'bg-blue-800' : 'hover:bg-blue-600'}`}
            >
              📜 Histórico de Sorteios
            </button>
          </div>
        )}

        {/* Conteúdo Principal por Tela */}
        <main className="flex-1 p-4 overflow-y-auto">

          {/* 1. TELA DE SORTEIO RÁPIDO (LANDING PAGE) */}
          {currentView === 'draft' && (
            <div className="space-y-4">
              
              {/* Área de Colar Texto */}
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 space-y-2">
                <label className="block text-sm font-bold text-blue-900">
                  Cole a lista de confirmados (WhatsApp):
                </label>
                <textarea 
                  rows="3"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Ex: 1- Lucas, 2- Camila, Mariana confirmed, Gabriel..."
                  className="w-full border rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <button 
                  onClick={handleIdentifyPlayers}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg text-sm transition"
                >
                  🔍 Identificar Jogadores
                </button>
              </div>

              {/* Lista de Jogadores Reconhecidos (Scroll próprio e Edição In-Place) */}
              {sessionPlayers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="font-bold text-gray-700 text-sm">
                      Jogadores na Mesa ({sessionPlayers.length})
                    </span>
                    <button 
                      onClick={() => setSessionPlayers([])}
                      className="text-xs text-red-500 font-bold"
                    >
                      Limpar Tudo
                    </button>
                  </div>

                  {/* Container de Cards com ROLAGEM PRÓPRIA */}

                  <PlayerList
                    players={sessionPlayers}
                    onUpdatePlayer={handleUpdateSessionPlayer}
                    onDeletePlayer={handleRemoveFromSession}
                  />
                </div>
              )}

              {/* Adicionar Jogador Rápido que Faltou */}
              <form onSubmit={handleAddQuickPlayer} className="flex gap-2">
                <input 
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="Nome de outro jogador..."
                  className="flex-1 border rounded-lg p-2 text-sm outline-none"
                />
                <button type="submit" className="bg-gray-800 text-white text-xs font-bold px-3 rounded-lg">
                  + Add
                </button>
              </form>

              {/* Configurações do Sorteio */}
              <div className="bg-white p-3 rounded-xl border space-y-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">FORMATO DO JOGO</label>
                  <div className="flex bg-gray-100 rounded-lg p-1">
                    {[2, 3, 4, 5, 6].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTeamSize(n)}
                        className={`flex-1 py-1 text-xs font-bold rounded-md ${teamSize === n ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
                      >
                        {n}x{n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBalanceGender(!balanceGender)}
                    className={`py-2 px-2 text-xs font-bold rounded-lg border ${balanceGender ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-gray-50 text-gray-400'}`}
                  >
                    👩/👨 Gênero {balanceGender ? '✓' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBalanceHeight(!balanceHeight)}
                    className={`py-2 px-2 text-xs font-bold rounded-lg border ${balanceHeight ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-gray-50 text-gray-400'}`}
                  >
                    📏 Altura {balanceHeight ? '✓' : ''}
                  </button>
                </div>
              </div>

              {/* Botão Principal de Ação */}
              <button 
                onClick={runMonteCarloDraft}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-xl text-lg shadow-lg transition"
              >
                Sortear Times!
              </button>
            </div>
          )}

          {/* 2. TELA DE PRÉVIA DO SORTEIO */}
          {currentView === 'preview' && draftPreview && (
            <div className="space-y-4 pb-12">
              <h2 className="text-xl font-bold text-center text-gray-800">Prévia do Sorteio</h2>

              {draftPreview.teams.map((team, idx) => {
                const scoreSum = team.reduce((a, b) => a + b.score, 0);
                return (
                  <div key={idx} className="bg-white border-2 border-blue-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="bg-blue-50 p-2 flex justify-between items-center border-b">
                      <span className="font-bold text-blue-900">Time {idx + 1}</span>
                      <span className="text-xs bg-blue-200 text-blue-800 font-bold px-2 py-0.5 rounded">
                        Força: {scoreSum}
                      </span>
                    </div>
                    <div className="p-2 space-y-1">
                      {team.map(p => (
                        <div key={p.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                          <span>{p.name} {p.gender === 'F' ? '👩' : '👨'} ({p.height === 'tall' ? 'Alto' : 'Baixo'})</span>
                          <span className="font-bold text-yellow-500">{p.score}⭐</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="flex gap-2 pt-4">
                <button 
                  onClick={runMonteCarloDraft} 
                  className="flex-1 bg-gray-200 hover:bg-gray-300 font-bold py-3 rounded-xl"
                >
                  🔄 Refazer
                </button>
                <button 
                  onClick={handleConfirmDraft} 
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl shadow-md"
                >
                  ✅ Confirmar
                </button>
              </div>
            </div>
          )}

          {/* 3. TELA DE GERENCIAMENTO COMPLETO DE JOGADORES */}
          {currentView === 'players' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-gray-800">Elenco Registrado</h2>
              <PlayerList
                players={players}
                onUpdatePlayer={handleUpdateSessionPlayer}
                // onDeletePlayer={handleDeletePlayer}
              />
            </div>
          )}

          {/* 4. TELA DE HISTÓRICO DE SORTEIOS */}
          {currentView === 'history' && draftHistory.length > 0 && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-white p-2 rounded-xl shadow-sm">
                <button 
                  onClick={() => setCurrentDraftIndex(Math.min(currentDraftIndex + 1, draftHistory.length - 1))}
                  disabled={currentDraftIndex === draftHistory.length - 1}
                  className="p-2 font-bold text-blue-600 disabled:text-gray-300"
                >
                  ← Anterior
                </button>
                <span className="text-xs text-gray-500">{draftHistory[currentDraftIndex].date}</span>
                <button 
                  onClick={() => setCurrentDraftIndex(Math.max(currentDraftIndex - 1, 0))}
                  disabled={currentDraftIndex === 0}
                  className="p-2 font-bold text-blue-600 disabled:text-gray-300"
                >
                  Próximo →
                </button>
              </div>

              {draftHistory[currentDraftIndex].teams.map((team, idx) => (
                <div key={idx} className="bg-white border rounded-xl p-3 shadow-sm space-y-1">
                  <h3 className="font-bold text-blue-800 border-b pb-1">Time {idx + 1}</h3>
                  {team.map(p => (
                    <div key={p.id} className="flex justify-between text-sm py-1">
                      <span>{p.name}</span>
                      <span>{p.score}⭐</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}