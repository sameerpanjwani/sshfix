import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

interface Entry {
  id: number;
  server_id: number;
  command?: string;
  output?: string;
  role?: string;
  message?: string;
  chat_session_id?: string;
  created_at: string;
}

const ServerDBView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [table, setTable] = useState<'history' | 'chat_history'>('history');
  const [sortField, setSortField] = useState<keyof Entry>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let endpoint = table === 'history' ? 'history' : 'chat';
        const res = await axios.get(`http://localhost:4000/api/servers/${id}/${endpoint}`);
        setEntries(res.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
      setLoading(false);
    };
    fetchData();
  }, [id, table]);

  const filteredEntries = entries.filter(entry => {
    const searchStr = filter.toLowerCase();
    return (
      (entry.command?.toLowerCase().includes(searchStr) || false) ||
      (entry.output?.toLowerCase().includes(searchStr) || false) ||
      (entry.message?.toLowerCase().includes(searchStr) || false) ||
      (entry.chat_session_id?.toString().includes(searchStr) || false)
    );
  });

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal === undefined || bVal === undefined) return 0;
    const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSort = (field: keyof Entry) => {
    if (field === sortField) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatContent = (content: string | undefined, isExpanded: boolean): string => {
    if (!content) return '';
    
    // Try to parse as JSON for better formatting
    try {
      const parsed = JSON.parse(content);
      return isExpanded 
        ? JSON.stringify(parsed, null, 2)
        : JSON.stringify(parsed);
    } catch {
      // Not JSON, handle as regular text
      return isExpanded 
        ? content 
        : content.length > 100 ? content.slice(0, 100) + '...' : content;
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
      <h2>Database Entries for Server {id}</h2>
      
      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <select 
          value={table} 
          onChange={e => setTable(e.target.value as 'history' | 'chat_history')}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc' }}
          title="Select table to view"
        >
          <option value="history">Terminal History</option>
          <option value="chat_history">Chat History</option>
        </select>
        
        <input
          type="text"
          placeholder="Filter entries..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', flex: 1 }}
        />
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('id')}>
                  ID {sortField === 'id' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                {table === 'history' ? (
                  <>
                    <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('command')}>
                      Command {sortField === 'command' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('output')}>
                      Output {sortField === 'output' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                  </>
                ) : (
                  <>
                    <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('role')}>
                      Role {sortField === 'role' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('message')}>
                      Message {sortField === 'message' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('chat_session_id')}>
                      Session {sortField === 'chat_session_id' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                  </>
                )}
                <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid #eee', cursor: 'pointer' }} onClick={() => handleSort('created_at')}>
                  Created At {sortField === 'created_at' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(entry => {
                const isExpanded = expandedRows.has(entry.id);
                return (
                  <tr 
                    key={entry.id} 
                    style={{ 
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      background: isExpanded ? '#f8fafc' : 'inherit'
                    }}
                    onClick={() => toggleRow(entry.id)}
                  >
                    <td style={{ padding: 12, maxWidth: 100 }}>{entry.id}</td>
                    {table === 'history' ? (
                      <>
                        <td style={{ 
                          padding: 12, 
                          maxWidth: 200,
                          whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                          overflow: 'hidden',
                          textOverflow: isExpanded ? 'clip' : 'ellipsis'
                        }}>
                          {entry.command}
                        </td>
                        <td style={{ 
                          padding: 12, 
                          maxWidth: 400,
                          whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                          overflow: 'hidden',
                          textOverflow: isExpanded ? 'clip' : 'ellipsis',
                          fontFamily: 'monospace'
                        }}>
                          {formatContent(entry.output, isExpanded)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: 12, maxWidth: 100 }}>{entry.role}</td>
                        <td style={{ 
                          padding: 12, 
                          maxWidth: 400,
                          whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                          overflow: 'hidden',
                          textOverflow: isExpanded ? 'clip' : 'ellipsis',
                          fontFamily: entry.role === 'ai' ? 'monospace' : 'inherit'
                        }}>
                          {formatContent(entry.message, isExpanded)}
                        </td>
                        <td style={{ padding: 12, maxWidth: 100 }}>{entry.chat_session_id}</td>
                      </>
                    )}
                    <td style={{ padding: 12, maxWidth: 200 }}>{new Date(entry.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ServerDBView; 