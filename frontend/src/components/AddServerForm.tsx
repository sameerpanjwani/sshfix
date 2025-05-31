import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { addServer, testNewServerConnection } from '../api/servers';

interface ServerForm {
  name: string;
  host: string;
  port: number | ''; // Allow empty string for initial state before validation
  username: string;
  password: string;
  privateKey: string;
  authMethod: 'password' | 'key';
}

interface ValidationErrors {
  name?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  privateKey?: string;
}

const AddServerForm: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState<ServerForm>({
    name: '',
    host: '',
    port: 22, // Default to 22, can be cleared
    username: '',
    password: '',
    privateKey: '',
    authMethod: 'password'
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [showValidationErrors, setShowValidationErrors] = useState(false); // Controls if individual field errors are shown
  const [error, setError] = useState(''); // Global error message
  const [testModal, setTestModal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [connectionTested, setConnectionTested] = useState(false);
  const [expandedHelp, setExpandedHelp] = useState<string | null>(null);
  const navigate = useNavigate();

  const validateStep = (step: number): boolean => {
    const errors: ValidationErrors = {};
    let isValid = true;

    if (step === 1) {
      if (!form.name.trim()) {
        errors.name = 'Server name is required';
        isValid = false;
      }
      if (!form.host.trim()) {
        errors.host = 'Host is required';
        isValid = false;
      }
      // Improved host validation to better match common formats
      if (form.host.trim() && !/^(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}|localhost|(?:[0-9]{1,3}\.){3}[0-9]{1,3})(?::\d+)?$/.test(form.host.trim())) {
        errors.host = 'Invalid host format (e.g., example.com, 192.168.1.1)';
        isValid = false;
      }
      if (form.port === '' || form.port === null || Number(form.port) < 1 || Number(form.port) > 65535) {
        errors.port = 'Valid port is required (1-65535)';
        isValid = false;
      }
    }

    if (step === 2) {
      if (!form.username.trim()) {
        errors.username = 'Username is required';
        isValid = false;
      }
      if (form.authMethod === 'password' && !form.password) {
        errors.password = 'Password is required';
        isValid = false;
      }
      if (form.authMethod === 'key' && !form.privateKey.trim()) {
        errors.privateKey = 'Private key is required';
        isValid = false;
      }
    }

    // For step 3, we primarily rely on connectionTested
    if (step === 3 && (!connectionTested || !testResult?.success)) {
        // This error is usually shown directly in step 3's UI or via global error
        isValid = false;
    }

    setValidationErrors(errors);
    return isValid;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let newValue: string | number = value;
    if (name === 'port') {
      newValue = value === '' ? '' : parseInt(value, 10);
      if (isNaN(Number(newValue)) && value !== '') newValue = form.port; // Revert if not a number and not empty
    }
    
    setForm(prev => ({ ...prev, [name]: newValue }));
    setConnectionTested(false); // Reset connection test status on any form change
    setTestResult(null);
    setError(''); // Clear global error on change

    // Inline validation for the changed field if errors were already shown globally for that step
    if (showValidationErrors || (validationErrors[name as keyof ValidationErrors] && name !== 'password' && name !== 'privateKey')) {
      const currentFieldErrors: ValidationErrors = {};
      if (name === 'name' && !String(newValue).trim()) currentFieldErrors.name = 'Server name is required';
      if (name === 'host') {
        if (!String(newValue).trim()) currentFieldErrors.host = 'Host is required';
        else if (!/^(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}|localhost|(?:[0-9]{1,3}\.){3}[0-9]{1,3})(?::\d+)?$/.test(String(newValue).trim())) {
            currentFieldErrors.host = 'Invalid host format';
        }
      }
      if (name === 'port' && (newValue === '' || Number(newValue) < 1 || Number(newValue) > 65535)) currentFieldErrors.port = 'Port must be 1-65535';
      if (name === 'username' && !String(newValue).trim()) currentFieldErrors.username = 'Username is required';
      
      setValidationErrors(prev => ({ ...prev, ...currentFieldErrors }));
    }
  };

  const handleAuthMethodChange = (method: 'password' | 'key') => {
    setForm(prev => ({ ...prev, authMethod: method, password: '', privateKey: '' }));
    setValidationErrors(prev => ({...prev, password: '', privateKey: ''})); // Clear only auth-related errors
    setConnectionTested(false);
    setTestResult(null);
    setError('');
  };

  const handleNext = () => {
    setShowValidationErrors(true);
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1);
      setError('');
      setShowValidationErrors(false);
    } else {
      setError('Please correct the errors highlighted above before proceeding.');
    }
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
    setError(''); 
    setShowValidationErrors(false); // Don't show errors when going back
    setValidationErrors({}); // Clear all validation errors
  };

  const handleTestConnection = async () => {
    setShowValidationErrors(true);
    if (!validateStep(1) || !validateStep(2)) { 
      setError('Please complete all required fields in Step 1 and Step 2 correctly before testing.');
      return;
    }
    setError('');
    setTesting(true);
    setTestModal(true);
    setTestResult(null);
    try {
      const { name, host, port, username, password, privateKey, authMethod } = form;
      const testData = {
        name,
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        password: authMethod === 'password' ? password : '',
        privateKey: authMethod === 'key' ? privateKey : ''
      };
      const result = await testNewServerConnection(testData);
      setTestResult(result);
      setConnectionTested(result.success);
      if (result.success) {
        setError('');
        // User will click 'Continue to Review' in modal to go to step 3
      } else {
        // Specific handling for duplicate server errors
        if (result.error && result.error.includes('already exists')) {
          setError('This server already exists. Please delete the existing server first if you wish to update it.');
        } else {
          setError(result.error || 'Connection test failed. Please check details and try again.');
        }
      }
    } catch (e: any) {
      const errorMsg = e?.response?.data?.error || e.message || 'An unknown error occurred during the connection test.';
      setTestResult({ success: false, error: errorMsg, tips: ['Verify your server details (host, port, username, password/key).', 'Check if your server is online and SSH is enabled.', 'Ensure your firewall is not blocking the connection.'] });
      setConnectionTested(false);
      setError(errorMsg);
    }
    setTesting(false);
  };

  const handleSubmit = async () => {
    setShowValidationErrors(true); // Show errors if any on final submit attempt
    if (!validateStep(1) || !validateStep(2)) { 
         setError('Information in Step 1 or Step 2 is incomplete or invalid. Please review.');
         setCurrentStep(1); // Go back to first step with errors
         return;
    }
    if (!connectionTested || !testResult?.success) {
      setError('The server connection has not been successfully tested. Please test before adding.');
      setTestModal(true); 
      setCurrentStep(2); // Go back to auth step to encourage re-testing
      return;
    }
    setError('');
    try {
      const { name, host, port, username, password, privateKey, authMethod } = form;
      await addServer({
        name: name.trim(),
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        password: authMethod === 'password' ? password : '',
        privateKey: authMethod === 'key' ? privateKey : ''
      });
      navigate('/');
    } catch (err: any) {
      // Check for duplicate server error
      if (err.response?.data?.error?.includes('already exists')) {
        setError('A server with this host and username already exists. Please use a different server or user.');
      } else {
        setError(err.response?.data?.error || err.message || 'Failed to add the server. An unexpected error occurred.');
      }
    }
  };

  const StepIndicator = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '2.5rem' }}>
      {[1, 2, 3].map((stepNum, index) => (
        <React.Fragment key={stepNum}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: stepNum < currentStep ? '#3b82f6' : (stepNum === currentStep ? '#3b82f6' : '#e5e7eb'),
            color: stepNum <= currentStep ? 'white' : '#9ca3af',
            border: stepNum === currentStep ? '2px solid #3b82f6' : (stepNum < currentStep ? '2px solid #3b82f6' : '2px solid #e5e7eb'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.875rem',
            fontWeight: '600',
            transition: 'background-color 0.3s, color 0.3s, border-color 0.3s'
          }}>
            {(stepNum === 3 && currentStep === 3 && connectionTested && testResult?.success) ? 
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z"/>
                </svg> 
                : stepNum}
          </div>
          {index < 2 && (
            <div style={{
              flexGrow: 1,
              maxWidth: '100px',
              height: '2px',
              backgroundColor: stepNum < currentStep ? '#3b82f6' : '#e5e7eb',
              margin: '0 0.75rem',
              transition: 'background-color 0.3s'
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  const globalErrorDisplay = error && (
    <div style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#b91c1c', borderRadius: '0.25rem', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem', textAlign: 'left' }}>
       <strong style={{display: 'block', marginBottom: '0.25rem'}}>Error:</strong>
       {error}
    </div>
 );

 return (
    <div className="form-container" style={{ padding: '2rem 1rem', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: '700', color: '#1f2937', marginBottom: '0.5rem' }}>
            Add New Server
          </h1>
          <p style={{ color: '#4b5563', fontSize: '1rem' }}>
            Connect to your server via SSH for management and troubleshooting
          </p>
        </div>

        <StepIndicator />
        
        {currentStep !== 3 && globalErrorDisplay} {/* Show global error on step 1 & 2 if present */}

        {(currentStep === 1 || currentStep === 2) && (
            <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)', padding: '2rem', marginBottom: '2.5rem' }}>
            {currentStep === 1 && (
                <div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#111827', marginBottom: '1.5rem', textAlign: 'left' }}>
                    Server Information
                </h2>
                <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                    <label htmlFor="serverName" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.375rem' }}>
                    Server Name
                    </label>
                    <input id="serverName" type="text" name="name" value={form.name} onChange={handleChange} placeholder="e.g. Production Server"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: showValidationErrors && validationErrors.name ? '1px solid #ef4444' : '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem'}} />
                    {showValidationErrors && validationErrors.name && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{validationErrors.name}</p>}
                </div>
                <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                    <label htmlFor="host" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.375rem' }}>Host</label>
                    <input id="host" type="text" name="host" value={form.host} onChange={handleChange} placeholder="e.g. 192.168.1.1 or example.com"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: showValidationErrors && validationErrors.host ? '1px solid #ef4444' : '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem'}} />
                    {showValidationErrors && validationErrors.host && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{validationErrors.host}</p>}
                </div>
                <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                    <label htmlFor="port" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.375rem' }}>Port</label>
                    <input id="port" type="number" name="port" value={form.port} onChange={handleChange} placeholder="22"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: showValidationErrors && validationErrors.port ? '1px solid #ef4444' : '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem'}} />
                    {showValidationErrors && validationErrors.port && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{validationErrors.port}</p>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                    <button onClick={handleNext} style={{ backgroundColor: '#3b82f6', color: 'white', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', fontSize: '0.875rem', fontWeight: '500', cursor:'pointer' }}>Next &rarr;</button>
                </div>
                </div>
            )}
            {currentStep === 2 && (
                <div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#111827', marginBottom: '1.5rem', textAlign: 'left' }}>Authentication</h2>
                <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                    <label htmlFor="username" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.375rem' }}>Username</label>
                    <input id="username" type="text" name="username" value={form.username} onChange={handleChange} placeholder="e.g. root"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: showValidationErrors && validationErrors.username ? '1px solid #ef4444' : '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem'}} />
                    {showValidationErrors && validationErrors.username && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{validationErrors.username}</p>}
                </div>
                <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>Authentication Method</label>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <label style={{ flex: 1, display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '0.75rem', border: form.authMethod === 'password' ? '2px solid #3b82f6' : '1px solid #d1d5db', borderRadius: '0.375rem', transition: 'border-color 0.2s' }}>
                            <input type="radio" name="authMethod" checked={form.authMethod === 'password'} onChange={() => handleAuthMethodChange('password')} style={{ marginRight: '0.5rem', accentColor: '#3b82f6' }} aria-label="Password authentication" />
                            Password
                        </label>
                        <label style={{ flex: 1, display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '0.75rem', border: form.authMethod === 'key' ? '2px solid #3b82f6' : '1px solid #d1d5db', borderRadius: '0.375rem', transition: 'border-color 0.2s' }}>
                            <input type="radio" name="authMethod" checked={form.authMethod === 'key'} onChange={() => handleAuthMethodChange('key')} style={{ marginRight: '0.5rem', accentColor: '#3b82f6' }} aria-label="SSH Key authentication" />
                            SSH Key
                        </label>
                    </div>
                </div>
                {form.authMethod === 'password' && (
                    <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                    <label htmlFor="password" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.375rem' }}>Password</label>
                    <input id="password" type="password" name="password" value={form.password} onChange={handleChange} aria-label="Server password" 
                           style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: showValidationErrors && validationErrors.password ? '1px solid #ef4444' : '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem'}} />
                    {showValidationErrors && validationErrors.password && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{validationErrors.password}</p>}
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.375rem' }}>Optional if using SSH key.</p>
                    </div>
                )}
                {form.authMethod === 'key' && (
                    <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                    <label htmlFor="privateKey" style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.375rem' }}>Private Key</label>
                    <textarea id="privateKey" name="privateKey" value={form.privateKey} onChange={handleChange} rows={4} placeholder="Paste your private key here (e.g., -----BEGIN RSA PRIVATE KEY-----...)"
                              style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: showValidationErrors && validationErrors.privateKey ? '1px solid #ef4444' : '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'monospace', resize: 'vertical' }} />
                    {showValidationErrors && validationErrors.privateKey && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>{validationErrors.privateKey}</p>}
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.375rem' }}>Optional if using password.</p>
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem' }}>
                    <button onClick={handleBack} style={{ backgroundColor: '#e5e7eb', color: '#374151', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', fontSize: '0.875rem', fontWeight: '500', cursor:'pointer' }}>Back</button>
                    <button onClick={handleTestConnection} disabled={testing} style={{ backgroundColor: testing ? '#9ca3af' : '#3b82f6', color: 'white', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', fontSize: '0.875rem', fontWeight: '500', cursor: testing? 'not-allowed' : 'pointer', opacity: testing ? 0.7 : 1 }}>
                    {testing ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
                </div>
            )}
            </div>
        )}

        {currentStep === 3 && (
            <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)', padding: '2rem', marginBottom: '2.5rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#111827', marginBottom: '1.5rem', textAlign: 'left' }}>Review & Add Server</h2>
                {globalErrorDisplay} 
                {testResult?.success && (
                    <div style={{ backgroundColor: '#dcfce7', borderLeft: '4px solid #4ade80', color: '#166534', borderRadius: '0.25rem', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem', textAlign: 'left' }}>
                        <strong style={{display: 'block', marginBottom: '0.25rem'}}>Connection Test Successful!</strong>
                        Server OS: {testResult.os || 'Not Detected'}. You can now add this server.
                    </div>
                )}
                 {!testResult?.success && (
                    <div style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#b91c1c', borderRadius: '0.25rem', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem', textAlign: 'left' }}>
                        <strong style={{display: 'block', marginBottom: '0.25rem'}}>
                            {testing ? 'Testing in progress...' : (connectionTested ? 'Connection Test Failed' : 'Connection Not Tested')}
                        </strong>
                        {testResult?.error || 'Please test the connection successfully before adding.'}
                        {!testing && !connectionTested && " Click 'Test Connection' on the previous step."}
                    </div>
                )}

                <div style={{ backgroundColor: '#f9fafb', borderRadius: '0.375rem', border: '1px solid #e5e7eb', padding: '1.25rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#1f2937', marginBottom: '0.75rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>Server Details:</h3>
                    <div style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: '1.6' }}>
                    {[ 
                        { label: 'Name', value: form.name }, 
                        { label: 'Host', value: form.host }, 
                        { label: 'Port', value: form.port }, 
                        { label: 'Username', value: form.username }, 
                        { label: 'Auth Method', value: form.authMethod === 'password' ? 'Password' : 'SSH Key' } 
                    ].map(detail => (
                        <div key={detail.label} style={{display: 'flex', marginBottom: '0.375rem'}}>
                            <strong style={{width: '120px', color: '#374151', flexShrink: 0}}>{detail.label}:</strong> 
                            <span style={{wordBreak: 'break-all'}}>{String(detail.value)}</span>
                        </div>
                    ))}
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem' }}>
                    <button onClick={handleBack} style={{ backgroundColor: '#e5e7eb', color: '#374151', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', fontSize: '0.875rem', fontWeight: '500', cursor: 'pointer' }}>Back</button>
                    <button onClick={handleSubmit} disabled={!connectionTested || !testResult?.success || testing} 
                            style={{ backgroundColor: (!connectionTested || !testResult?.success || testing) ? '#9ca3af' : '#22c55e', color: 'white', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: 'none', fontSize: '0.875rem', fontWeight: '500', cursor: (!connectionTested || !testResult?.success || testing) ? 'not-allowed' : 'pointer', opacity: (!connectionTested || !testResult?.success || testing) ? 0.7 : 1 }}>
                        {testing ? 'Testing...' : 'Add Server'}
                    </button>
                </div>
            </div>
        )}


        <div style={{ marginTop: '3rem' }}> 
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1f2937', marginBottom: '0.5rem', textAlign: 'left' }}>
            How to Get Server Credentials
          </h2>
          <p style={{ color: '#4b5563', fontSize: '0.875rem', marginBottom: '1.5rem', textAlign: 'left' }}>
            Follow these guides to find the credentials for your specific hosting provider
          </p>

          {[
            {
              id: 'whm',
              title: 'WHM/cPanel Server',
              subtitle: 'Web hosting control panel',
              icon: '📄',
              content: (
                <div style={{textAlign: 'left'}}>
                  <ol style={{ paddingLeft: '1.25rem', margin: '0 0 1rem 0', listStyle: 'decimal' }}>
                    <li>Log in to WHM as root.</li>
                    <li>Search for "SSH Access" or go to Security Center → Manage SSH Keys.</li>
                    <li>Click on "Generate a New Key".</li>
                    <li>Enter a name for your key (e.g., "sshfix-app").</li>
                    <li>Set key size to 2048 or 4096 bits.</li>
                    <li>Click "Generate Key".</li>
                    <li>After generating, click "View/Download Key" for the public key. For the private key, you must first **authorize** it, then you can view/download it.</li>
                    <li>Copy the **private key** content (it usually starts with `-----BEGIN RSA PRIVATE KEY-----`).</li>
                  </ol>
                  <div style={{ backgroundColor: '#fffbeb', borderLeft: '4px solid #fcd34d', borderRadius: '0.25rem', padding: '1rem', marginTop: '1rem'}}>
                    <h4 style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', fontWeight: '600', color: '#92400e', margin: '0 0 0.5rem 0' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{marginRight: '0.5rem', flexShrink: 0}}>
                            <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
                        </svg>
                        Important Security Notes
                    </h4>
                    <ul style={{ fontSize: '0.875rem', color: '#b45309', paddingLeft: '1.25rem', margin: 0, listStyleType: 'disc' }}>
                        <li>Keep your private key secure and never share it.</li>
                        <li>Use key-based authentication instead of passwords if possible.</li>
                        <li>Authorize the key in WHM/cPanel after generation if required by your setup.</li>
                        <li>Consider restricting SSH access to specific IP addresses in your server/firewall settings.</li>
                    </ul>
                  </div>
                </div>
              )
            },
            {
                id: 'digitalocean',
                title: 'DigitalOcean Droplet',
                subtitle: 'Cloud virtual machine',
                icon: '💧',
                content: (
                  <div style={{textAlign: 'left'}}>
                    <ol style={{ paddingLeft: '1.25rem', margin: '0 0 1rem 0', listStyle: 'decimal' }}>
                      <li>Go to your DigitalOcean dashboard.</li>
                      <li>Select your Droplet to find its IP address.</li>
                      <li>Default username is `root` for new Droplets (unless configured otherwise).</li>
                      <li><strong>Authentication options:</strong>
                          <ul style={{paddingLeft: '1.25rem', marginTop: '0.5rem', listStyleType: 'disc'}}>
                              <li>Use the password emailed to you during Droplet creation.</li>
                              <li>If SSH key was added during creation, use that private key.</li>
                              <li>Access console from DigitalOcean dashboard to reset password if needed.</li>
                          </ul>
                      </li>
                    </ol>
                    <div style={{ backgroundColor: '#eff6ff', borderLeft: '4px solid #60a5fa', borderRadius: '0.25rem', padding: '1rem', marginTop: '1rem' }}>
                      <h4 style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', fontWeight: '600', color: '#1e40af', margin: '0 0 0.5rem 0' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{marginRight: '0.5rem', flexShrink: 0}}>
                           <path fillRule="evenodd" d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
                        </svg>
                        For security best practices:
                      </h4>
                      <ul style={{ fontSize: '0.875rem', color: '#1c51b0', paddingLeft: '1.25rem', margin: 0, listStyleType: 'disc' }}>
                          <li>Create a non-root user with sudo privileges.</li>
                          <li>Set up SSH key authentication and disable password authentication.</li>
                          <li>Configure a firewall (DigitalOcean provides an easy UFW interface).</li>
                      </ul>
                    </div>
                  </div>
                )
              },
              {
                id: 'aws',
                title: 'AWS EC2 Instance',
                subtitle: 'Amazon Web Services virtual server',
                icon: '📦',
                content: (
                  <div style={{textAlign: 'left'}}>
                    <ol style={{ paddingLeft: '1.25rem', margin: '0 0 1rem 0', listStyle: 'decimal' }}>
                      <li>Go to the EC2 dashboard and select your instance.</li>
                      <li>Find the public IP address or DNS name.</li>
                      <li><strong>Username depends on the AMI:</strong>
                          <ul style={{paddingLeft: '1.25rem', marginTop: '0.5rem', listStyleType: 'disc'}}>
                              <li>`ec2-user` for Amazon Linux</li>
                              <li>`ubuntu` for Ubuntu</li>
                              <li>`centos` for CentOS</li>
                              <li>Other AMIs may have different default users.</li>
                          </ul>
                      </li>
                      <li>Use the private key (.pem file) downloaded when you created the instance.</li>
                    </ol>
                    <div style={{ backgroundColor: '#4b5563', color: '#f3f4f6', borderRadius: '0.25rem', padding: '1rem', marginTop: '1rem' }}> {/* Darker card for AWS example */}
                      <h4 style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', fontWeight: '600', color: '#e5e7eb', margin: '0 0 0.5rem 0' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{marginRight: '0.5rem', flexShrink: 0}}>
                            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h11A1.5 1.5 0 0 1 14 2.5v10.155a.5.5 0 0 1-.273.454l-1.495.855a.5.5 0 0 1-.454 0L10.5 13.107l-1.74.995a.5.5 0 0 1-.52 0l-1.74-.994-1.256.718a.5.5 0 0 1-.454 0L3.273 13.11a.5.5 0 0 1-.273-.455V2.5zm1.5.5A.5.5 0 0 0 1 3.5v9.967l.273.156a.5.5 0 0 1 .454 0L3.5 12.893l1.74.994a.5.5 0 0 1 .52 0l1.74-.994 1.256.718a.5.5 0 0 1 .454 0L12.5 12.893l.273.156A.5.5 0 0 1 13 13.467V3.5a.5.5 0 0 0-.5-.5h-11zM2 3h10v2H2V3zm0 3h10v2H2V6zm0 3h10v2H2V9z"/>
                        </svg>
                        Command Example:
                      </h4>
                      <pre style={{ margin: 0, padding: '0.5rem', backgroundColor: '#374151', borderRadius: '0.25rem', overflowX: 'auto', fontSize: '0.8125rem', color: '#d1d5db' }}>
                          <code>ssh -i /path/to/key.pem ec2-user@your-instance-ip</code>
                      </pre>
                    </div>
                  </div>
                )
              },
              {
                id: 'generic',
                title: 'Generic Linux Server',
                subtitle: 'For any other hosting provider',
                icon: '🐧',
                content: (
                  <div style={{textAlign: 'left'}}>
                    <p style={{marginBottom: '1rem'}}>Contact your hosting provider or check their documentation for:</p>
                    <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem 0', listStyleType: 'disc' }}>
                      <li>Server's IP address or hostname</li>
                      <li>SSH port (usually 22)</li>
                      <li>Your SSH username</li>
                      <li>Authentication method (password or SSH key)</li>
                    </ul>
                    <div style={{ backgroundColor: '#f3f4f6', borderLeft: '4px solid #9ca3af', borderRadius: '0.25rem', padding: '1rem', marginTop: '1rem' }}>
                      <h4 style={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', fontWeight: '600', color: '#374151', margin: '0 0 0.5rem 0' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{marginRight: '0.5rem', flexShrink: 0}}>
                            <path d="M0 2.5A1.5 1.5 0 0 1 1.5 1h11A1.5 1.5 0 0 1 14 2.5v10.155a.5.5 0 0 1-.273.454l-1.495.855a.5.5 0 0 1-.454 0L10.5 13.107l-1.74.995a.5.5 0 0 1-.52 0l-1.74-.994-1.256.718a.5.5 0 0 1-.454 0L3.273 13.11a.5.5 0 0 1-.273-.455V2.5zm1.5.5A.5.5 0 0 0 1 3.5v9.967l.273.156a.5.5 0 0 1 .454 0L3.5 12.893l1.74.994a.5.5 0 0 1 .52 0l1.74-.994 1.256.718a.5.5 0 0 1 .454 0L12.5 12.893l.273.156A.5.5 0 0 1 13 13.467V3.5a.5.5 0 0 0-.5-.5h-11zM2 3h10v2H2V3zm0 3h10v2H2V6zm0 3h10v2H2V9z"/>
                        </svg>
                        For SSH key setup:
                      </h4>
                      <ol style={{ fontSize: '0.875rem', color: '#4b5563', paddingLeft: '1.25rem', margin: 0, listStyle: 'decimal'}}>
                          <li>Generate an SSH key pair on your local machine if you don't have one.</li>
                          <li>Upload the public key to your server (usually to `~/.ssh/authorized_keys`).</li>
                          <li>Set proper permissions (e.g., `chmod 700 ~/.ssh` and `chmod 600 ~/.ssh/authorized_keys`).</li>
                          <li>Use the private key for authentication with this application.</li>
                      </ol>
                    </div>
                  </div>
                )
              }
          ].map((item) => (
            <div 
                key={item.id} 
                style={{
                    backgroundColor: 'white',
                    borderRadius: '0.5rem',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    marginBottom: '1rem',
                    transition: 'box-shadow 0.2s ease-in-out',
                    overflow: 'hidden',
                    width: '100%',
                    maxWidth: '100%'
                }}
                onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'}
                onMouseOut={(e) => e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'}
            >
              <button
                onClick={() => setExpandedHelp(expandedHelp === item.id ? null : item.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1.25rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                aria-controls={`help-content-${item.id}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                  <span style={{ fontSize: '1.25rem', color: '#4b5563', flexShrink: 0 }}>{item.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.9375rem', fontWeight: '500', color: '#1f2937' }}>
                      {item.title}
                    </div>
                    {item.subtitle && <div style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{item.subtitle}</div>}
                  </div>
                </div>
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="18" 
                  height="18" 
                  fill="currentColor" 
                  viewBox="0 0 16 16"
                  style={{ 
                    color: '#6b7280',
                    transform: expandedHelp === item.id ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease-in-out',
                    flexShrink: 0,
                    marginLeft: '1rem'
                  }}
                >
                  <path fillRule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                </svg>
              </button>
              {expandedHelp === item.id && (
                <div 
                    id={`help-content-${item.id}`} 
                    style={{ 
                        padding: '0 1.25rem 1.25rem 1.25rem',
                        fontSize: '0.875rem', 
                        color: '#374151', 
                        lineHeight: '1.6',
                        textAlign: 'left',
                        borderTop: '1px solid #f3f4f6',
                        marginTop: '0.5rem',
                        width: '100%',
                        boxSizing: 'border-box',
                        maxWidth: '100%',
                        overflowX: 'hidden'
                    }}
                >
                  {item.content}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: '2.5rem', paddingBottom: '3rem' }}>
          <Link 
            to="/" 
            style={{ 
              color: '#3b82f6', 
              textDecoration: 'none', 
              fontSize: '0.875rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              fontWeight: '500'
            }}
            onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" style={{marginTop:'-1px'}}>
                <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
            Back to Servers
          </Link>
        </div>
      </div>

      {testModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '0.5rem', padding: '1.75rem', width: '100%', maxWidth: '420px', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', color: testing ? '#374151' : (testResult?.success ? '#16a34a' : '#dc2626'), margin: 0 }}>
                {testing ? 'Testing Connection...' : testResult?.success ? 'Connection Successful' : 'Connection Failed'}
              </h3>
              <button onClick={() => setTestModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#9ca3af', lineHeight: '1' }} aria-label="Close modal">
                &times;
              </button>
            </div>
            {testing && 
                <div style={{textAlign: 'center', padding: '1.5rem 0'}}>
                    <svg aria-hidden="true" style={{width: '2.5rem', height: '2.5rem', color: '#e5e7eb', fill: '#3b82f6', animation: 'spin 1s linear infinite'}} viewBox="0 0 100 101" xmlns="http://www.w3.org/2000/svg">
                        <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                        <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0492C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 40.0117 89.083 44.3446 88.1811 48.4805C87.8424 50.0224 88.1397 51.6106 88.9493 52.9233C89.7589 54.236 91.0131 55.1501 92.4467 55.4978C93.8803 55.8456 95.3801 55.6017 96.6548 54.803C97.9296 54.0043 98.89 52.7063 99.3041 51.2128C99.7182 49.7192 99.5619 48.1004 98.8626 46.6911C98.1633 45.2818 96.9594 44.1541 95.4961 43.4863C94.0328 42.8185 92.3878 42.6495 90.9003 43.029C89.4127 43.4085 88.1383 44.3218 87.2369 45.619C86.3354 46.9161 85.8579 48.5307 85.8579 50.1983C85.8579 51.8659 86.3354 53.4805 87.2369 54.7776C88.1383 56.0748 89.4127 56.988 90.9003 57.3675C92.3878 57.7471 94.0328 57.5781 95.4961 56.9103C96.9594 56.2425 98.1633 55.1147 98.8626 53.7054C99.5619 52.2961 99.7182 50.6773 99.3041 49.1837Z" fill="#D1D5DB"/>
                    </svg>
                    <p style={{ color: '#6b7280', margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>Please wait...</p>
                </div>
            }
            {testResult && !testing && (
              <div style={{ fontSize: '0.875rem', textAlign: 'left', marginTop: '0.5rem' }}>
                {testResult.success && (
                    <p style={{ margin: '0 0 0.5rem 0', color: '#374151'}}>
                        <strong>Server OS:</strong> {testResult.os || 'Not Detected'}
                    </p>
                )}
                {testResult.error && (
                  <p style={{ color: '#b91c1c', margin: '0 0 0.5rem 0', fontWeight: '500', wordBreak: 'break-word' }}>
                    <strong>Error:</strong> {testResult.error}
                  </p>
                )}
                {testResult.tips && testResult.tips.length > 0 && (
                  <div style={{marginTop: '0.75rem'}}>
                    <strong style={{color: '#4b5563'}}>Tips to resolve:</strong>
                    <ul style={{ paddingLeft: '1.25rem', margin: '0.25rem 0 0 0', color: '#4b5563', listStyleType: 'disc' }}>
                      {testResult.tips.map((tip: string, i: number) => (
                        <li key={i} style={{marginBottom: '0.25rem'}}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <button onClick={() => { setTestModal(false); if (testResult?.success) {setCurrentStep(3); setError('');} }}
              style={{ marginTop: '1.5rem', width: '100%', padding: '0.625rem', backgroundColor: testResult?.success ? '#22c55e' : '#3b82f6', color: 'white', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: '500', cursor: 'pointer' }}>
              {testing ? 'Testing...' : (testResult?.success ? 'Continue to Review' : 'Close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddServerForm; 